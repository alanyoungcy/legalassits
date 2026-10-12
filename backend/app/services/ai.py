"""Capco Wayne AI copilot — API_KEY + BASE_URL + MODEL from .env."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from loguru import logger

from app.config import Settings, get_settings
from app.services.skills import skill_registry
from app.services.web_search import brave_search


SYSTEM_PROMPT = """You are {copilot_name}, Capco's contract copilot inside Capco Contract Assists.
You help lawyers and contract managers draft, complete yellow-highlighted fields, and review agreements.
Every material finding must be a draft for attorney review — not legal advice.
Be concise, practical, and cite clause language when available.

Mode rules (critical):
- If Mode is assess, review, or understand: ASSESSMENT ONLY in chat.
  Follow the Active skill playbook / checklist below (loaded from Capco's skills library).
  When Web research (Brave Search) is present, use it to ground market norms and cite URLs.
  Structure findings as GREEN / YELLOW / RED with clause cites, risk, and recommendation.
  Do NOT emit a ```fields block. Do NOT invent or change field values.
  Do NOT rewrite or overwrite the contract. Keep the live Word document unchanged.
- If Mode is improve or sources: advisory chat only — still do not mutate document fields.
  You may use web research when provided.
- If Mode is complete: Document completion applies (below).

Document completion (only when Mode is complete):
- Values you assign are written into the live Word document automatically as you stream.
- Whenever the user gives facts (parties, dates, jurisdiction, purpose, term, etc.), extract them into field keys.
- As soon as you know values, emit this machine-readable block (do this EARLY, before long prose):

```fields
field_key: concrete value
```

- Then ask ONE clear question about the single most important still-empty field.
- Keep interviewing until every empty field has a value; only then offer playbook review.
- Prefer today's real calendar date when the user says "today" / "now".
- Do not invent party names or jurisdictions the user did not provide; ask instead.
"""

ASSESS_MODES = frozenset({"assess", "review", "understand"})


class CopilotService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def status(self) -> dict[str, Any]:
        return {
            "copilot_name": self.settings.copilot_name,
            "base_url": self.settings.base_url,
            "model": self.settings.model,
            "configured": self.settings.ai_configured,
            "brave_search": self.settings.brave_configured,
        }

    async def _web_research(
        self,
        *,
        mode: str,
        agreement_type: str | None,
        document_title: str | None,
        document_text: str | None,
        messages: list[dict[str, str]],
    ) -> str:
        if mode not in ASSESS_MODES and mode != "sources":
            return ""
        user_message = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content") or ""
                break
        return await brave_search.research_for_assessment(
            agreement_type=agreement_type,
            title=document_title,
            document_text=document_text,
            user_message=user_message,
        )

    def _prepare(
        self,
        *,
        messages: list[dict[str, str]],
        mode: str,
        document_title: str | None,
        document_text: str | None,
        fields: list[dict[str, Any]] | None,
        skill_id: str | None,
        agreement_type: str | None = None,
        web_research: str | None = None,
    ) -> tuple[str, str, dict[str, Any] | None]:
        skill: dict[str, Any] | None = None
        skill_context = ""
        if mode in ASSESS_MODES or skill_id:
            try:
                skill = skill_registry.route_review_skill(
                    agreement_type=agreement_type,
                    title=document_title,
                    document_text=document_text,
                    explicit_skill_id=skill_id,
                )
            except (KeyError, ValueError) as exc:
                logger.warning("Skill routing failed: {}", exc)
                skill = None
            if skill:
                headings = skill.get("headings") or []
                heading_block = (
                    "Playbook headings: " + "; ".join(headings[:16]) if headings else ""
                )
                skill_context = (
                    f"Active skill (FOLLOW THIS PLAYBOOK): {skill['id']}\n"
                    f"Name: {skill.get('name')}\n"
                    f"Plugin: {skill.get('plugin')}\n"
                    f"Description: {skill.get('description')}\n"
                    f"{heading_block}\n\n"
                    f"{(skill.get('body') or '')[:6000]}\n"
                )
                catalog = skill_registry.enabled_review_catalog()
                if catalog:
                    skill_context += "\nEnabled Capco review skills available in this workspace:\n"
                    for row in catalog:
                        skill_context += f"- {row['id']}: {row['name']}\n"

        field_lines = []
        for field in fields or []:
            field_lines.append(
                f"- {field.get('key')}: placeholder={field.get('placeholder')} "
                f"value={field.get('value') or '(empty)'}"
            )

        research_block = f"{web_research.strip()}\n\n" if web_research and web_research.strip() else ""
        context = (
            f"Mode: {mode}\n"
            f"Agreement type: {agreement_type or '(unknown)'}\n"
            f"Document: {document_title or 'Untitled'}\n"
            f"Fields:\n" + ("\n".join(field_lines) if field_lines else "(none)") + "\n\n"
            f"Document text (truncated):\n{(document_text or '')[:12000]}\n\n"
            f"{research_block}"
            f"{skill_context}"
        )
        system = SYSTEM_PROMPT.format(copilot_name=self.settings.copilot_name)
        return system, context, skill

    async def chat(
        self,
        *,
        messages: list[dict[str, str]],
        mode: str = "understand",
        document_title: str | None = None,
        document_text: str | None = None,
        fields: list[dict[str, Any]] | None = None,
        skill_id: str | None = None,
        agreement_type: str | None = None,
    ) -> dict[str, Any]:
        web_research = await self._web_research(
            mode=mode,
            agreement_type=agreement_type,
            document_title=document_title,
            document_text=document_text,
            messages=messages,
        )
        system, context, skill = self._prepare(
            messages=messages,
            mode=mode,
            document_title=document_title,
            document_text=document_text,
            fields=fields,
            skill_id=skill_id,
            agreement_type=agreement_type,
            web_research=web_research,
        )
        meta = {
            "skill_id": skill["id"] if skill else None,
            "skill_name": skill.get("name") if skill else None,
            "web_search": bool(web_research),
        }
        if not self.settings.ai_configured:
            reply = self._offline_reply(
                messages=messages, mode=mode, context=context, fields=fields or []
            )
            reply.update(meta)
            return reply

        try:
            content = await self._chat(system=system, context=context, messages=messages)
            return {
                "role": "assistant",
                "content": content,
                "base_url": self.settings.base_url,
                "model": self.settings.model,
                "copilot_name": self.settings.copilot_name,
                "offline": False,
                **meta,
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("AI chat failed: {}", exc)
            fallback = self._offline_reply(
                messages=messages, mode=mode, context=context, fields=fields or []
            )
            fallback["content"] = f"(AI call failed: {exc})\n\n" + fallback["content"]
            fallback["error"] = str(exc)
            fallback.update(meta)
            return fallback

    async def chat_stream(
        self,
        *,
        messages: list[dict[str, str]],
        mode: str = "understand",
        document_title: str | None = None,
        document_text: str | None = None,
        fields: list[dict[str, Any]] | None = None,
        skill_id: str | None = None,
        agreement_type: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield event dicts: optional skill meta, then {delta}, then done is handled by router."""
        web_research = await self._web_research(
            mode=mode,
            agreement_type=agreement_type,
            document_title=document_title,
            document_text=document_text,
            messages=messages,
        )
        system, context, skill = self._prepare(
            messages=messages,
            mode=mode,
            document_title=document_title,
            document_text=document_text,
            fields=fields,
            skill_id=skill_id,
            agreement_type=agreement_type,
            web_research=web_research,
        )
        if skill or web_research:
            yield {
                "skill_id": skill["id"] if skill else None,
                "skill_name": skill.get("name") if skill else None,
                "plugin": skill.get("plugin") if skill else None,
                "web_search": bool(web_research),
            }
        if not self.settings.ai_configured:
            offline = self._offline_reply(
                messages=messages, mode=mode, context=context, fields=fields or []
            )
            yield {"delta": offline["content"]}
            return

        try:
            async for delta in self._chat_stream(system=system, context=context, messages=messages):
                if delta:
                    yield {"delta": delta}
        except Exception as exc:  # noqa: BLE001
            logger.exception("AI stream failed: {}", exc)
            yield {"delta": f"\n\n(AI stream failed: {exc})"}

    async def _chat(
        self,
        *,
        system: str,
        context: str,
        messages: list[dict[str, str]],
    ) -> str:
        chunks: list[str] = []
        async for delta in self._chat_stream(system=system, context=context, messages=messages):
            chunks.append(delta)
        if chunks:
            return "".join(chunks)
        # Non-streaming fallback
        base = self.settings.base_url.rstrip("/")
        payload = {
            "model": self.settings.model,
            "temperature": self.settings.temperature,
            "max_tokens": self.settings.max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "system", "content": context},
                *[{"role": m["role"], "content": m["content"]} for m in messages],
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        return data["choices"][0]["message"]["content"]

    async def _chat_stream(
        self,
        *,
        system: str,
        context: str,
        messages: list[dict[str, str]],
    ) -> AsyncIterator[str]:
        base = self.settings.base_url.rstrip("/")
        payload = {
            "model": self.settings.model,
            "temperature": self.settings.temperature,
            "max_tokens": self.settings.max_tokens,
            "stream": True,
            "messages": [
                {"role": "system", "content": system},
                {"role": "system", "content": context},
                *[{"role": m["role"], "content": m["content"]} for m in messages],
            ],
        }
        headers = {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{base}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data:"):
                        data = line[5:].strip()
                    else:
                        data = line.strip()
                    if not data or data == "[DONE]":
                        if data == "[DONE]":
                            break
                        continue
                    try:
                        payload_obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = payload_obj.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        yield piece

    def _offline_reply(
        self,
        *,
        messages: list[dict[str, str]],
        mode: str,
        context: str,
        fields: list[dict[str, Any]],
    ) -> dict[str, Any]:
        last = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        missing = [f["key"] for f in fields if not f.get("value")]
        content = (
            f"I'm {self.settings.copilot_name}. AI is not configured yet — set `API_KEY` "
            f"(and optionally `BASE_URL`, `MODEL`) in `.env`.\n\n"
            f"**Mode:** {mode}\n"
            f"**Your ask:** {last or '(none)'}\n\n"
            "I can still help structure the work:\n"
            "1. Complete yellow fields in the Variables panel\n"
            "2. Run a commercial/employment skill review\n"
            "3. Upload a counterparty paper for review-first analysis\n"
        )
        if missing:
            content += "\n**Empty fields:** " + ", ".join(missing[:12])
        return {
            "role": "assistant",
            "content": content,
            "base_url": self.settings.base_url,
            "model": self.settings.model,
            "copilot_name": self.settings.copilot_name,
            "offline": True,
            "context_chars": len(context),
        }


copilot = CopilotService()

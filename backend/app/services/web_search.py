"""Brave Search API client for Capco Wayne Assessment research."""

from __future__ import annotations

from typing import Any

import httpx
from loguru import logger

from app.config import Settings, get_settings

BRAVE_WEB_URL = "https://api.search.brave.com/res/v1/web/search"


class BraveSearchService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    @property
    def configured(self) -> bool:
        return self.settings.brave_configured

    async def search(
        self,
        query: str,
        *,
        count: int = 8,
        freshness: str | None = None,
    ) -> list[dict[str, str]]:
        q = (query or "").strip()
        if not q:
            return []
        if not self.configured:
            logger.warning("Brave Search not configured — skipping web research")
            return []

        params: dict[str, Any] = {
            "q": q[:600],
            "count": max(1, min(count, 20)),
            "result_filter": "web",
            "safesearch": "moderate",
        }
        if freshness:
            params["freshness"] = freshness

        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": self.settings.brave_api_key or "",
        }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(BRAVE_WEB_URL, params=params, headers=headers)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Brave Search failed for {!r}: {}", q, exc)
            return []

        results: list[dict[str, str]] = []
        for item in (data.get("web") or {}).get("results") or []:
            title = (item.get("title") or "").strip()
            url = (item.get("url") or "").strip()
            description = (item.get("description") or item.get("snippet") or "").strip()
            if not (title or description):
                continue
            results.append(
                {
                    "title": title,
                    "url": url,
                    "snippet": description,
                }
            )
        return results

    async def research_for_assessment(
        self,
        *,
        agreement_type: str | None,
        title: str | None,
        document_text: str | None = None,
        user_message: str | None = None,
    ) -> str:
        """Build a short web-research brief for Assessment mode."""
        if not self.configured:
            return ""

        hay = f"{agreement_type or ''} {title or ''} {user_message or ''}".lower()
        queries: list[str] = []

        if user_message and len(user_message.strip()) > 12:
            queries.append(f"{user_message.strip()[:180]} contract legal best practice")

        if "nda" in hay or "non-disclosure" in hay or "confidential" in hay:
            queries.extend(
                [
                    "mutual NDA confidentiality term market standard years commercial",
                    "NDA governing law jurisdiction best practices cross-border",
                ]
            )
        elif "msa" in hay or "saas" in hay or "vendor" in hay or "master service" in hay:
            queries.extend(
                [
                    "vendor MSA limitation of liability market standard Capco",
                    "SaaS MSA data protection audit rights playbook norms",
                ]
            )
        elif "employment" in hay or "offer" in hay or "termination" in hay:
            queries.append("employment contract review best practice confidentiality non-compete")
        else:
            doc_hint = (document_text or "")[:240].replace("\n", " ")
            queries.append(
                f"{agreement_type or title or 'commercial contract'} legal review best practices {doc_hint[:80]}"
            )

        # Dedupe while preserving order
        seen: set[str] = set()
        unique_queries: list[str] = []
        for q in queries:
            key = q.lower()
            if key in seen:
                continue
            seen.add(key)
            unique_queries.append(q)

        blocks: list[str] = []
        for q in unique_queries[:3]:
            hits = await self.search(q, count=5)
            if not hits:
                continue
            lines = [f"Query: {q}"]
            for i, hit in enumerate(hits[:5], start=1):
                lines.append(
                    f"{i}. {hit['title']}\n   {hit['url']}\n   {hit['snippet']}"
                )
            blocks.append("\n".join(lines))

        if not blocks:
            return ""
        return (
            "Web research (Brave Search) — use as supporting context only; "
            "cite sources when relied upon; not legal advice:\n\n"
            + "\n\n".join(blocks)
        )


brave_search = BraveSearchService()

"""Skill catalog over vendored anthropics/claude-for-legal plugins."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from loguru import logger

from app.config import Settings, get_settings

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)

# Capco defaults: review-focused commercial + employment skills enabled
DEFAULT_ENABLED = {
    "commercial-legal/review",
    "commercial-legal/nda-review",
    "commercial-legal/vendor-agreement-review",
    "commercial-legal/saas-msa-review",
    "commercial-legal/escalation-flagger",
    "commercial-legal/stakeholder-summary",
    "commercial-legal/renewal-tracker",
    "commercial-legal/amendment-history",
    "employment-legal/hiring-review",
    "employment-legal/termination-review",
    "employment-legal/worker-classification",
    "employment-legal/policy-drafting",
    "employment-legal/wage-hour-qa",
}

REVIEW_SKILLS = {
    "commercial-legal/review",
    "commercial-legal/nda-review",
    "commercial-legal/vendor-agreement-review",
    "commercial-legal/saas-msa-review",
    "employment-legal/hiring-review",
    "employment-legal/termination-review",
    "employment-legal/worker-classification",
}


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    meta_raw, body = match.group(1), match.group(2)
    try:
        meta = yaml.safe_load(meta_raw) or {}
    except Exception:  # noqa: BLE001
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, body


def _plugin_version(plugin_dir: Path) -> str | None:
    plugin_json = plugin_dir / ".claude-plugin" / "plugin.json"
    if not plugin_json.exists():
        return None
    try:
        return json.loads(plugin_json.read_text(encoding="utf-8")).get("version")
    except Exception:  # noqa: BLE001
        return None


class SkillRegistry:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.vendor_root = self.settings.skills_vendor_dir
        self.state_path = self.settings.data_dir / "skills_state.json"
        self._skills: dict[str, dict[str, Any]] = {}
        self._state: dict[str, Any] = {"skills": {}, "updated_at": None}
        self.refresh()

    def refresh(self) -> list[dict[str, Any]]:
        self._load_state()
        found: dict[str, dict[str, Any]] = {}
        for plugin_dir in sorted(self.vendor_root.glob("*")):
            if not plugin_dir.is_dir():
                continue
            plugin = plugin_dir.name
            version = _plugin_version(plugin_dir)
            skills_root = plugin_dir / "skills"
            if not skills_root.is_dir():
                continue
            for skill_dir in sorted(skills_root.iterdir()):
                skill_md = skill_dir / "SKILL.md"
                if not skill_md.exists():
                    continue
                skill_id = f"{plugin}/{skill_dir.name}"
                text = skill_md.read_text(encoding="utf-8")
                meta, body = _parse_frontmatter(text)
                state = self._state["skills"].setdefault(
                    skill_id,
                    {
                        "enabled": skill_id in DEFAULT_ENABLED,
                        "favorite": skill_id in REVIEW_SKILLS,
                        "notes": "",
                    },
                )
                found[skill_id] = {
                    "id": skill_id,
                    "plugin": plugin,
                    "name": meta.get("name") or skill_dir.name,
                    "description": (meta.get("description") or "").strip(),
                    "argument_hint": meta.get("argument-hint"),
                    "user_invocable": meta.get("user-invocable", True),
                    "plugin_version": version,
                    "source": "anthropics/claude-for-legal",
                    "source_path": str(skill_md.resolve()),
                    "enabled": bool(state.get("enabled", False)),
                    "favorite": bool(state.get("favorite", False)),
                    "notes": state.get("notes") or "",
                    "review_capable": skill_id in REVIEW_SKILLS or "review" in skill_dir.name,
                    "body_preview": body.strip()[:1200],
                    "body": body.strip(),
                    "headings": self._extract_headings(body),
                }
        self._skills = found
        self._save_state()
        logger.info("indexed {} legal skills from {}", len(found), self.vendor_root)
        return self.list_skills()

    def list_skills(
        self,
        *,
        plugin: str | None = None,
        enabled_only: bool = False,
        review_only: bool = False,
    ) -> list[dict[str, Any]]:
        items = list(self._skills.values())
        if plugin:
            items = [item for item in items if item["plugin"] == plugin]
        if enabled_only:
            items = [item for item in items if item["enabled"]]
        if review_only:
            items = [item for item in items if item["review_capable"]]
        return [
            {k: v for k, v in item.items() if k != "body"}
            for item in sorted(items, key=lambda row: (row["plugin"], row["name"]))
        ]

    def get(self, skill_id: str, *, include_body: bool = False) -> dict[str, Any] | None:
        item = self._skills.get(skill_id)
        if not item:
            return None
        if include_body:
            return item
        return {k: v for k, v in item.items() if k != "body"}

    def update_skill(
        self,
        skill_id: str,
        *,
        enabled: bool | None = None,
        favorite: bool | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        if skill_id not in self._skills:
            raise KeyError(skill_id)
        state = self._state["skills"].setdefault(skill_id, {})
        if enabled is not None:
            state["enabled"] = enabled
            self._skills[skill_id]["enabled"] = enabled
        if favorite is not None:
            state["favorite"] = favorite
            self._skills[skill_id]["favorite"] = favorite
        if notes is not None:
            state["notes"] = notes
            self._skills[skill_id]["notes"] = notes
        self._save_state()
        return self.get(skill_id)  # type: ignore[return-value]

    def plugins(self) -> list[dict[str, Any]]:
        groups: dict[str, list[dict[str, Any]]] = {}
        for item in self._skills.values():
            groups.setdefault(item["plugin"], []).append(item)
        result = []
        for plugin, skills in sorted(groups.items()):
            result.append(
                {
                    "id": plugin,
                    "name": plugin,
                    "source": "anthropics/claude-for-legal",
                    "version": skills[0].get("plugin_version"),
                    "skill_count": len(skills),
                    "enabled_count": sum(1 for s in skills if s["enabled"]),
                    "review_count": sum(1 for s in skills if s["review_capable"] and s["enabled"]),
                }
            )
        return result

    def route_review_skill(
        self,
        *,
        agreement_type: str | None,
        title: str | None = None,
        document_text: str | None = None,
        explicit_skill_id: str | None = None,
    ) -> dict[str, Any]:
        if explicit_skill_id:
            skill = self.get(explicit_skill_id, include_body=True)
            if not skill:
                raise KeyError(explicit_skill_id)
            if not skill["enabled"]:
                raise ValueError(f"Skill disabled: {explicit_skill_id}")
            return skill

        haystack = f"{agreement_type or ''} {title or ''} {(document_text or '')[:2000]}".lower()
        ordered_candidates = [
            ("nda", "commercial-legal/nda-review"),
            ("non-disclosure", "commercial-legal/nda-review"),
            ("confidentiality", "commercial-legal/nda-review"),
            ("saas", "commercial-legal/saas-msa-review"),
            ("subscription", "commercial-legal/saas-msa-review"),
            ("msa", "commercial-legal/vendor-agreement-review"),
            ("master service", "commercial-legal/vendor-agreement-review"),
            ("consultancy", "commercial-legal/vendor-agreement-review"),
            ("consulting", "commercial-legal/vendor-agreement-review"),
            ("vendor", "commercial-legal/vendor-agreement-review"),
            ("sow", "commercial-legal/vendor-agreement-review"),
            ("employment", "employment-legal/hiring-review"),
            ("offer letter", "employment-legal/hiring-review"),
            ("offer", "employment-legal/hiring-review"),
            ("hire", "employment-legal/hiring-review"),
            ("termination", "employment-legal/termination-review"),
            ("classification", "employment-legal/worker-classification"),
        ]
        for needle, skill_id in ordered_candidates:
            if needle in haystack and skill_id in self._skills and self._skills[skill_id]["enabled"]:
                return self.get(skill_id, include_body=True)  # type: ignore[return-value]

        fallback = "commercial-legal/review"
        if fallback in self._skills and self._skills[fallback]["enabled"]:
            return self.get(fallback, include_body=True)  # type: ignore[return-value]
        enabled_review = next(
            (s for s in self._skills.values() if s["enabled"] and s["review_capable"]),
            None,
        )
        if not enabled_review:
            raise ValueError("No enabled review skills")
        return self.get(enabled_review["id"], include_body=True)  # type: ignore[return-value]

    def enabled_review_catalog(self, *, limit: int = 24) -> list[dict[str, str]]:
        rows = [
            {
                "id": s["id"],
                "name": s["name"],
                "plugin": s["plugin"],
                "description": (s.get("description") or "")[:180],
            }
            for s in self._skills.values()
            if s["enabled"] and s["review_capable"]
        ]
        rows.sort(key=lambda r: (r["plugin"], r["name"]))
        return rows[:limit]

    def _load_state(self) -> None:
        if not self.state_path.exists():
            self._state = {"skills": {}, "updated_at": None}
            return
        self._state = json.loads(self.state_path.read_text(encoding="utf-8"))

    def _save_state(self) -> None:
        self._state["updated_at"] = datetime.now(timezone.utc).isoformat()
        # Keep only managed fields
        compact = {
            "updated_at": self._state["updated_at"],
            "skills": {
                skill_id: {
                    "enabled": self._skills[skill_id]["enabled"],
                    "favorite": self._skills[skill_id]["favorite"],
                    "notes": self._skills[skill_id]["notes"],
                }
                for skill_id in self._skills
            },
            "source": "anthropics/claude-for-legal",
            "plugins": ["commercial-legal", "employment-legal"],
        }
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(compact, indent=2), encoding="utf-8")

    @staticmethod
    def _extract_headings(body: str) -> list[str]:
        headings = []
        for line in body.splitlines():
            if line.startswith("## "):
                headings.append(line[3:].strip())
            elif line.startswith("### "):
                headings.append(line[4:].strip())
        return headings[:40]


skill_registry = SkillRegistry()

"""Filesystem-backed corporate template catalog.

Drop Word (.docx) files into the `templates/` folder. Optional sidecar
`*.meta.json` files can describe agreement type, jurisdiction, and entity scope.

Yellow-highlighted text in the Word document becomes fillable fields.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from app.config import Settings, get_settings
from app.models.schemas import TemplateDetail, TemplateField, TemplateSummary
from app.services.field_discovery import prepare_template_fields
from app.services.yellow_fields import scan_docx


IGNORED_PREFIXES = (".", "~$", "_")

# Primary browse categories (Capco contract families)
STANDARD_CATEGORIES = (
    "NDA",
    "MSA",
    "SOW",
    "Employment",
    "Vendor Agreement",
    "License Agreement",
    "DPA",
    "Consultancy Agreement",
    "Other",
)


def _stem_id(path: Path) -> str:
    stem = path.stem
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", stem).strip("-").lower() or "template"


def _category_slug(category: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", category.strip()).strip("-").lower() or "other"


def _normalize_category(raw: str | None) -> str:
    if not raw or not str(raw).strip():
        return "Other"
    value = " ".join(str(raw).split()).strip()
    lowered = value.lower()
    aliases = {
        "nda": "NDA",
        "non-disclosure": "NDA",
        "non disclosure": "NDA",
        "confidentiality": "NDA",
        "msa": "MSA",
        "master services": "MSA",
        "master service agreement": "MSA",
        "sow": "SOW",
        "statement of work": "SOW",
        "employment": "Employment",
        "employment agreement": "Employment",
        "vendor": "Vendor Agreement",
        "vendor agreement": "Vendor Agreement",
        "license": "License Agreement",
        "license agreement": "License Agreement",
        "dpa": "DPA",
        "consultancy": "Consultancy Agreement",
        "consultancy agreement": "Consultancy Agreement",
        "other": "Other",
    }
    if lowered in aliases:
        return aliases[lowered]
    for standard in STANDARD_CATEGORIES:
        if standard.lower() == lowered:
            return standard
    # Title-case custom categories the user typed
    return value[:60]


def _load_sidecar(path: Path) -> dict:
    # Prefer name.docx.meta.json or name.meta.json
    candidates = [
        path.with_name(path.name + ".meta.json"),
        path.with_suffix(".meta.json"),
    ]
    for candidate in candidates:
        if candidate.exists():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                logger.warning("invalid template metadata {}: {}", candidate, exc)
    return {}


def _write_sidecar(path: Path, meta: dict) -> Path:
    sidecar = path.with_suffix(".meta.json")
    sidecar.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return sidecar


def _guess_agreement_type(name: str) -> str | None:
    lowered = name.lower()
    mapping = {
        "nda": "NDA",
        "non-disclosure": "NDA",
        "msa": "MSA",
        "master service": "MSA",
        "sow": "SOW",
        "statement of work": "SOW",
        "employment": "Employment",
        "vendor": "Vendor Agreement",
        "license": "License Agreement",
        "dpa": "DPA",
        "consultancy": "Consultancy Agreement",
    }
    for needle, label in mapping.items():
        if needle in lowered:
            return label
    return None


class TemplateCatalog:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._cache: dict[str, TemplateDetail] = {}

    def refresh(self) -> list[TemplateSummary]:
        templates_dir = self.settings.templates_dir
        templates_dir.mkdir(parents=True, exist_ok=True)
        found: dict[str, TemplateDetail] = {}

        for path in sorted(templates_dir.rglob("*.docx")):
            if any(part.startswith(IGNORED_PREFIXES) for part in path.parts):
                continue
            if path.name.startswith("~$"):
                continue
            try:
                detail = self._index_file(path)
            except Exception as exc:  # noqa: BLE001
                logger.exception("failed to index template {}: {}", path, exc)
                continue
            found[detail.id] = detail

        self._cache = found
        self._persist_cache()
        return [self._to_summary(item) for item in found.values()]

    def list_templates(self) -> list[TemplateSummary]:
        if not self._cache:
            self.refresh()
        return [self._to_summary(item) for item in self._cache.values()]

    def get(self, template_id: str) -> TemplateDetail | None:
        if not self._cache:
            self.refresh()
        return self._cache.get(template_id)

    def resolve_path(self, template_id: str) -> Path | None:
        detail = self.get(template_id)
        if not detail:
            return None
        path = Path(detail.source_path)
        return path if path.exists() else None

    def list_categories(self) -> list[dict]:
        """Return standard + discovered categories with template counts."""
        summaries = self.list_templates()
        counts: dict[str, int] = {c: 0 for c in STANDARD_CATEGORIES}
        for item in summaries:
            cat = _normalize_category(item.category or item.agreement_type)
            counts[cat] = counts.get(cat, 0) + 1
        ordered = list(STANDARD_CATEGORIES)
        for cat in sorted(counts):
            if cat not in ordered:
                ordered.append(cat)
        return [{"id": cat, "name": cat, "count": counts.get(cat, 0)} for cat in ordered]

    async def save_upload(
        self,
        *,
        filename: str,
        content: bytes,
        category: str | None = None,
        name: str | None = None,
        use_ai: bool = True,
    ) -> TemplateDetail:
        """Persist an uploaded .docx; AI/heuristics yellow-highlight fillable blanks."""
        resolved = _normalize_category(category or _guess_agreement_type(filename) or "Other")
        folder = _category_slug(resolved)
        safe_name = Path(filename).name
        if not safe_name.lower().endswith(".docx"):
            safe_name = f"{safe_name}.docx"
        safe_name = re.sub(r"[^\w.\- ]+", "_", safe_name).strip() or "upload.docx"
        dest_dir = self.settings.templates_dir / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / safe_name
        if dest.exists():
            stem = dest.stem
            dest = dest_dir / f"{stem}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.docx"
        dest.write_bytes(content)

        discovery = await prepare_template_fields(dest, use_ai=use_ai)

        display_name = (name or Path(safe_name).stem).replace("_", " ").replace("-", " ").strip()
        meta = {
            "id": _stem_id(dest),
            "name": display_name,
            "category": resolved,
            "agreement_type": resolved,
            "description": (
                f"Uploaded {resolved} template. "
                f"{discovery.get('field_count', 0)} yellow fields detected "
                f"(AI + blank analysis)."
            ),
            "discovery": {
                "bracket_highlights": discovery.get("bracket_highlights", 0),
                "underscore_highlights": discovery.get("underscore_highlights", 0),
                "ai_highlights": discovery.get("ai_highlights", 0),
                "field_count": discovery.get("field_count", 0),
            },
        }
        _write_sidecar(dest, meta)

        self.refresh()
        detail = self.get(meta["id"]) or self._index_file(dest)
        self._cache[detail.id] = detail
        self._persist_cache()
        return detail

    def update_template(
        self,
        template_id: str,
        *,
        name: str | None = None,
        category: str | None = None,
        agreement_type: str | None = None,
        jurisdiction: str | None = None,
        entity_scope: str | None = None,
        description: str | None = None,
    ) -> TemplateDetail | None:
        """Update template metadata sidecar (and move file if category changes)."""
        detail = self.get(template_id)
        if not detail:
            return None
        path = Path(detail.source_path)
        if not path.exists():
            return None

        meta = _load_sidecar(path)
        meta["id"] = template_id
        if name is not None:
            meta["name"] = name.strip() or meta.get("name") or path.stem
        if category is not None:
            meta["category"] = _normalize_category(category)
            meta["agreement_type"] = meta["category"]
        if agreement_type is not None and category is None:
            meta["agreement_type"] = agreement_type.strip() or meta.get("agreement_type")
            meta["category"] = _normalize_category(meta.get("category") or meta["agreement_type"])
        if jurisdiction is not None:
            meta["jurisdiction"] = jurisdiction.strip() or None
        if entity_scope is not None:
            meta["entity_scope"] = entity_scope.strip() or None
        if description is not None:
            meta["description"] = description.strip() or None

        # Move into category folder when category changed
        resolved_cat = _normalize_category(meta.get("category") or detail.category)
        meta["category"] = resolved_cat
        target_dir = self.settings.templates_dir / _category_slug(resolved_cat)
        target_dir.mkdir(parents=True, exist_ok=True)
        dest = path
        if path.parent.resolve() != target_dir.resolve():
            dest = target_dir / path.name
            if dest.exists() and dest.resolve() != path.resolve():
                dest = target_dir / f"{path.stem}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}{path.suffix}"
            path.rename(dest)
            # move sidecar(s)
            for candidate in (
                path.with_suffix(".meta.json"),
                path.with_name(path.name + ".meta.json"),
            ):
                if candidate.exists():
                    candidate.unlink(missing_ok=True)

        _write_sidecar(dest, meta)
        self.refresh()
        return self.get(template_id) or self._index_file(dest)

    def delete_template(self, template_id: str) -> bool:
        """Delete template .docx and sidecar from disk, then refresh catalog."""
        detail = self.get(template_id)
        if not detail:
            return False
        path = Path(detail.source_path)
        for candidate in (
            path.with_suffix(".meta.json"),
            path.with_name(path.name + ".meta.json"),
        ):
            if candidate.exists():
                candidate.unlink(missing_ok=True)
        if path.exists():
            path.unlink()
        self._cache.pop(template_id, None)
        self.refresh()
        return True

    def _index_file(self, path: Path) -> TemplateDetail:
        scanned = scan_docx(path)
        meta = _load_sidecar(path)
        template_id = meta.get("id") or _stem_id(path)
        name = meta.get("name") or path.stem.replace("_", " ").replace("-", " ").strip()
        agreement = meta.get("agreement_type") or _guess_agreement_type(name)
        category = _normalize_category(
            meta.get("category") or agreement or path.parent.name
        )
        fields = [
            TemplateField(
                key=item["key"],
                label=item["label"],
                placeholder=item["placeholder"],
                occurrence_count=item["occurrence_count"],
                help_text=meta.get("fields", {}).get(item["key"], {}).get("help_text"),
                required=meta.get("fields", {}).get(item["key"], {}).get("required", True),
                field_type=meta.get("fields", {}).get(item["key"], {}).get("field_type", "short_text"),
                sample_context=item.get("sample_context"),
            )
            for item in scanned.fields.values()
        ]
        fields.sort(key=lambda f: f.label.lower())
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        return TemplateDetail(
            id=template_id,
            name=name,
            filename=path.name,
            category=category,
            agreement_type=agreement or category,
            jurisdiction=meta.get("jurisdiction"),
            entity_scope=meta.get("entity_scope"),
            description=meta.get("description"),
            field_count=len(fields),
            required_field_count=sum(1 for f in fields if f.required),
            updated_at=mtime,
            checksum=scanned.checksum,
            source_path=str(path.resolve()),
            fields=fields,
            preview_text=scanned.preview_text,
            metadata={**meta, "category": category},
        )

    def _persist_cache(self) -> None:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "templates": [item.model_dump(mode="json") for item in self._cache.values()],
        }
        self.settings.catalog_cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings.catalog_cache_path.write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _to_summary(detail: TemplateDetail) -> TemplateSummary:
        return TemplateSummary(
            id=detail.id,
            name=detail.name,
            filename=detail.filename,
            category=detail.category or detail.agreement_type,
            agreement_type=detail.agreement_type,
            jurisdiction=detail.jurisdiction,
            entity_scope=detail.entity_scope,
            description=detail.description,
            field_count=detail.field_count,
            required_field_count=detail.required_field_count,
            updated_at=detail.updated_at,
            checksum=detail.checksum,
            source_path=detail.source_path,
        )


catalog = TemplateCatalog()

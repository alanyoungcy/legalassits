"""Contract generation from corporate Word templates."""

from __future__ import annotations

import base64
import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import Settings, get_settings
from app.models.schemas import (
    ContractCreateRequest,
    ContractDetail,
    ContractSummary,
    FieldState,
    TemplateField,
)
from app.services.catalog import TemplateCatalog, catalog
from app.services.documents import document_store
from app.services.yellow_fields import fill_docx


class ContractStore:
    def __init__(
        self,
        settings: Settings | None = None,
        template_catalog: TemplateCatalog | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.catalog = template_catalog or catalog
        self.index_path = self.settings.data_dir / "contracts_index.json"
        self._items: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        if not self.index_path.exists():
            self._items = {}
            return
        self._items = json.loads(self.index_path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.index_path.write_text(json.dumps(self._items, indent=2), encoding="utf-8")

    def list_contracts(self) -> list[ContractSummary]:
        return [self._to_summary(item) for item in sorted(
            self._items.values(),
            key=lambda row: row["created_at"],
            reverse=True,
        )]

    def get(self, contract_id: str) -> ContractDetail | None:
        row = self._items.get(contract_id)
        if not row:
            return None
        template = self.catalog.get(row["template_id"])
        fields = []
        if template:
            for field in template.fields:
                value = row.get("field_values", {}).get(field.key, "")
                state = FieldState.filled if value else FieldState.missing
                fields.append(field.model_copy(update={"state": state}))
        return ContractDetail(
            **self._to_summary(row).model_dump(),
            field_values=row.get("field_values", {}),
            fields=fields,
        )

    def create(self, request: ContractCreateRequest) -> ContractDetail:
        template = self.catalog.get(request.template_id)
        if not template:
            raise KeyError(f"Unknown template: {request.template_id}")
        source = Path(template.source_path)
        if not source.exists():
            raise FileNotFoundError(template.source_path)

        contract_id = f"ctr_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)
        output = self.settings.contracts_dir / contract_id / f"{contract_id}.docx"
        missing = fill_docx(source, output, request.field_values, clear_highlight=True)

        required_keys = {f.key for f in template.fields if f.required}
        missing_required = sorted(required_keys.intersection(missing))
        status = "draft_incomplete" if missing_required else "draft_ready"

        row = {
            "id": contract_id,
            "title": request.title,
            "template_id": template.id,
            "template_name": template.name,
            "status": status,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "field_values": request.field_values,
            "missing_fields": missing_required,
            "download_path": str(output.resolve()),
            "legal_entity": request.legal_entity,
            "governing_law": request.governing_law,
            "counterparty": request.counterparty,
            "matter_ref": request.matter_ref,
            "total_field_count": template.field_count,
            "filled_field_count": sum(
                1 for f in template.fields if request.field_values.get(f.key)
            ),
        }
        self._items[contract_id] = row
        self._save()
        detail = self.get(contract_id)
        assert detail is not None
        return detail

    def update_fields(self, contract_id: str, field_values: dict[str, str]) -> ContractDetail:
        row = self._items.get(contract_id)
        if not row:
            raise KeyError(contract_id)
        template = self.catalog.get(row["template_id"])
        if not template:
            raise KeyError(row["template_id"])
        merged = {**row.get("field_values", {}), **field_values}
        source = Path(template.source_path)
        output = Path(row["download_path"])
        missing = fill_docx(source, output, merged, clear_highlight=True)
        required_keys = {f.key for f in template.fields if f.required}
        missing_required = sorted(required_keys.intersection(missing))
        row["field_values"] = merged
        row["missing_fields"] = missing_required
        row["status"] = "draft_incomplete" if missing_required else "draft_ready"
        row["updated_at"] = datetime.now(timezone.utc).isoformat()
        row["filled_field_count"] = sum(1 for f in template.fields if merged.get(f.key))
        row["total_field_count"] = template.field_count
        self._save()
        detail = self.get(contract_id)
        assert detail is not None
        return detail

    def save_workspace(
        self,
        *,
        title: str,
        field_values: dict[str, str] | None = None,
        template_id: str | None = None,
        document_id: str | None = None,
        agreement_type: str | None = None,
        docx_base64: str | None = None,
        contract_id: str | None = None,
    ) -> ContractDetail:
        """Persist the live workspace draft into Inbox (contracts index)."""
        values = {k: v for k, v in (field_values or {}).items() if (v or "").strip()}
        now = datetime.now(timezone.utc)
        existing = self._items.get(contract_id) if contract_id else None
        cid = existing["id"] if existing else f"ctr_{uuid.uuid4().hex[:12]}"
        out_dir = self.settings.contracts_dir / cid
        out_dir.mkdir(parents=True, exist_ok=True)
        output = out_dir / f"{cid}.docx"

        template = self.catalog.get(template_id) if template_id else None
        template_name = (
            (template.name if template else None)
            or (existing or {}).get("template_name")
            or "Workspace draft"
        )
        tid = (template.id if template else None) or (existing or {}).get("template_id") or (
            f"doc:{document_id}" if document_id else "workspace"
        )

        if docx_base64:
            output.write_bytes(base64.b64decode(docx_base64))
            if template and values:
                # Re-fill from template when we only have values and no editor bytes? skip
                pass
        elif template:
            missing = fill_docx(
                Path(template.source_path),
                output,
                values,
                clear_highlight=False,
            )
        elif document_id:
            doc = document_store.get(document_id)
            if not doc:
                raise KeyError(f"Unknown document: {document_id}")
            source = Path(doc["path"])
            if not source.exists():
                raise FileNotFoundError(doc["path"])
            if values:
                fill_docx(source, output, values, clear_highlight=False)
            else:
                shutil.copy2(source, output)
        elif existing and Path(existing.get("download_path") or "").exists():
            if values and template_id and template:
                fill_docx(Path(template.source_path), output, values, clear_highlight=False)
            else:
                shutil.copy2(existing["download_path"], output)
        else:
            raise ValueError("Need template_id, document_id, or docx bytes to save")

        if template:
            required_keys = {f.key for f in template.fields if f.required}
            missing_required = sorted(
                k for k in required_keys if not values.get(k)
            )
            total = template.field_count
            filled = sum(1 for f in template.fields if values.get(f.key))
        else:
            missing_required = []
            total = len(values) or (existing or {}).get("total_field_count", 0)
            filled = sum(1 for v in values.values() if v)

        status = "draft_incomplete" if missing_required else "draft_ready"
        row = {
            "id": cid,
            "title": title.strip() or "Untitled Document",
            "template_id": tid,
            "template_name": template_name,
            "status": status,
            "inbox": True,
            "created_at": (existing or {}).get("created_at") or now.isoformat(),
            "updated_at": now.isoformat(),
            "field_values": values or (existing or {}).get("field_values", {}),
            "missing_fields": missing_required,
            "download_path": str(output.resolve()),
            "legal_entity": values.get("capco_legal_entity")
            or values.get("disclosing_party")
            or (existing or {}).get("legal_entity"),
            "governing_law": values.get("governing_law") or (existing or {}).get("governing_law"),
            "counterparty": values.get("receiving_party")
            or values.get("counterparty")
            or (existing or {}).get("counterparty"),
            "matter_ref": (existing or {}).get("matter_ref"),
            "total_field_count": total,
            "filled_field_count": filled,
            "agreement_type": agreement_type
            or (template.agreement_type if template else None)
            or (existing or {}).get("agreement_type"),
            "source_document_id": document_id or (existing or {}).get("source_document_id"),
        }
        self._items[cid] = row
        self._save()
        detail = self.get(cid)
        assert detail is not None
        return detail

    @staticmethod
    def _to_summary(row: dict) -> ContractSummary:
        return ContractSummary(
            id=row["id"],
            title=row["title"],
            template_id=row["template_id"],
            template_name=row["template_name"],
            status=row["status"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            missing_fields=row.get("missing_fields", []),
            filled_field_count=row.get("filled_field_count", 0),
            total_field_count=row.get("total_field_count", 0),
            download_path=row.get("download_path"),
            legal_entity=row.get("legal_entity"),
            governing_law=row.get("governing_law"),
            counterparty=row.get("counterparty"),
            agreement_type=row.get("agreement_type"),
        )


contract_store = ContractStore()

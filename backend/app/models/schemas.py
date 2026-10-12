"""Pydantic schemas for Capco Contract Assists."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class FieldState(str, Enum):
    missing = "missing"
    suggested = "suggested"
    filled = "filled"
    needs_review = "needs_review"
    locked = "locked"


class TemplateField(BaseModel):
    key: str
    label: str
    placeholder: str
    occurrence_count: int = 1
    help_text: str | None = None
    required: bool = True
    field_type: str = "short_text"
    state: FieldState = FieldState.missing
    sample_context: str | None = None


class TemplateSummary(BaseModel):
    id: str
    name: str
    filename: str
    # Contract family used for browse/filter (NDA, MSA, SOW, …)
    category: str | None = None
    agreement_type: str | None = None
    jurisdiction: str | None = None
    entity_scope: str | None = None
    description: str | None = None
    field_count: int = 0
    required_field_count: int = 0
    updated_at: datetime | None = None
    checksum: str
    source_path: str


class TemplateDetail(TemplateSummary):
    fields: list[TemplateField] = Field(default_factory=list)
    preview_text: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ContractCreateRequest(BaseModel):
    template_id: str
    title: str
    field_values: dict[str, str] = Field(default_factory=dict)
    matter_ref: str | None = None
    legal_entity: str | None = None
    governing_law: str | None = None
    counterparty: str | None = None


class ContractSummary(BaseModel):
    id: str
    title: str
    template_id: str
    template_name: str
    status: str
    created_at: datetime
    updated_at: datetime
    missing_fields: list[str] = Field(default_factory=list)
    filled_field_count: int = 0
    total_field_count: int = 0
    download_path: str | None = None
    legal_entity: str | None = None
    governing_law: str | None = None
    counterparty: str | None = None
    agreement_type: str | None = None


class ContractDetail(ContractSummary):
    field_values: dict[str, str] = Field(default_factory=dict)
    fields: list[TemplateField] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    version: str
    product: str
    templates_indexed: int
    copilot: str = "Capco Wayne"
    ai_configured: bool = False

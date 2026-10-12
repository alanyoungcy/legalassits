"""Contract draft API."""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.models.schemas import ContractCreateRequest, ContractDetail, ContractSummary
from app.services.contracts import contract_store

router = APIRouter(prefix="/contracts", tags=["contracts"])

DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class FieldUpdateRequest(BaseModel):
    field_values: dict[str, str] = Field(default_factory=dict)


class WorkspaceSaveRequest(BaseModel):
    """Save the live Word workspace into Inbox."""

    title: str
    field_values: dict[str, str] = Field(default_factory=dict)
    template_id: str | None = None
    document_id: str | None = None
    agreement_type: str | None = None
    docx_base64: str | None = None
    contract_id: str | None = None


@router.get("", response_model=list[ContractSummary])
async def list_contracts() -> list[ContractSummary]:
    return contract_store.list_contracts()


@router.post("", response_model=ContractDetail)
async def create_contract(request: ContractCreateRequest) -> ContractDetail:
    try:
        return contract_store.create(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Template file missing: {exc}") from exc


@router.post("/from-workspace", response_model=ContractDetail)
async def save_from_workspace(request: WorkspaceSaveRequest) -> ContractDetail:
    try:
        return contract_store.save_workspace(
            title=request.title,
            field_values=request.field_values,
            template_id=request.template_id,
            document_id=request.document_id,
            agreement_type=request.agreement_type,
            docx_base64=request.docx_base64,
            contract_id=request.contract_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{contract_id}", response_model=ContractDetail)
async def get_contract(contract_id: str) -> ContractDetail:
    detail = contract_store.get(contract_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Contract not found")
    return detail


@router.patch("/{contract_id}/fields", response_model=ContractDetail)
async def update_contract_fields(contract_id: str, request: FieldUpdateRequest) -> ContractDetail:
    try:
        return contract_store.update_fields(contract_id, request.field_values)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{contract_id}/download")
async def download_contract(contract_id: str) -> FileResponse:
    detail = contract_store.get(contract_id)
    if not detail or not detail.download_path:
        raise HTTPException(status_code=404, detail="Contract not found")
    path = Path(detail.download_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Generated file missing")
    filename = f"{detail.title.replace(' ', '_')}.docx"
    return FileResponse(
        path,
        media_type=DOCX_MEDIA,
        filename=filename,
    )

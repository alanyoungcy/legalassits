"""Document upload + editor payload APIs."""

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.catalog import catalog
from app.services.documents import document_store
from app.services.editor_content import docx_to_blocks
from app.services.yellow_fields import fill_docx

router = APIRouter(prefix="/documents", tags=["documents"])

DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class FillFieldsRequest(BaseModel):
    """Fill yellow placeholders and return a new .docx for the live editor to reload."""

    values: dict[str, str] = Field(default_factory=dict)
    template_id: str | None = None
    document_id: str | None = None
    clear_highlight: bool = False


@router.get("")
async def list_documents() -> list[dict]:
    return [
        {k: v for k, v in item.items() if k not in {"blocks", "plain_text"}}
        for item in document_store.list_documents()
    ]


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    mode: str = "review",
) -> dict:
    try:
        return await document_store.save_upload(file, mode=mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/fill-fields")
async def fill_fields(body: FillFieldsRequest) -> Response:
    """Server-side yellow-field fill — used when the browser editor cannot find placeholders."""
    if not body.values:
        raise HTTPException(status_code=400, detail="No values provided")

    source: Path | None = None
    if body.template_id:
        template = catalog.get(body.template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        source = Path(template.source_path)
    elif body.document_id:
        doc = document_store.get(body.document_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        source = Path(doc["path"])
    else:
        raise HTTPException(status_code=400, detail="template_id or document_id required")

    if not source or not source.exists():
        raise HTTPException(status_code=404, detail="Source .docx missing")

    settings = get_settings()
    out_dir = settings.data_dir / "filled"
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"fill_{uuid4().hex}.docx"
    try:
        fill_docx(source, dest, body.values, clear_highlight=body.clear_highlight)
        data = dest.read_bytes()
    finally:
        if dest.exists():
            dest.unlink(missing_ok=True)  # type: ignore[arg-type]

    return Response(
        content=data,
        media_type=DOCX_MEDIA,
        headers={"Content-Disposition": 'attachment; filename="filled.docx"'},
    )


@router.get("/workspace/from-template/{template_id}")
async def workspace_from_template(template_id: str) -> dict:
    template = catalog.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    path = Path(template.source_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template file missing")
    editor = docx_to_blocks(path)
    return {
        "source": "template",
        "template_id": template.id,
        "template_name": template.name,
        "agreement_type": template.agreement_type,
        "title": template.name,
        "docx_url": f"/api/v1/documents/workspace/from-template/{template.id}/docx",
        **editor,
    }


@router.get("/workspace/from-template/{template_id}/docx")
async def download_template_docx(template_id: str) -> FileResponse:
    template = catalog.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    path = Path(template.source_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template file missing")
    return FileResponse(path, media_type=DOCX_MEDIA, filename=template.filename)


@router.get("/{document_id}/docx")
async def download_document_docx(document_id: str) -> FileResponse:
    doc = document_store.get(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = Path(doc["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing")
    return FileResponse(path, media_type=DOCX_MEDIA, filename=doc.get("filename") or path.name)


@router.get("/{document_id}")
async def get_document(document_id: str) -> dict:
    doc = document_store.get(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    payload = dict(doc)
    payload["docx_url"] = f"/api/v1/documents/{document_id}/docx"
    return payload

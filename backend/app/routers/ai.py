"""Capco Wayne AI endpoints."""

import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.ai import copilot
from app.services.web_search import brave_search

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"] = "user"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    mode: Literal[
        "understand",
        "improve",
        "sources",
        "review",
        "assess",
        "complete",
    ] = "understand"
    document_title: str | None = None
    document_text: str | None = None
    agreement_type: str | None = None
    fields: list[dict[str, Any]] = Field(default_factory=list)
    skill_id: str | None = None


class WebSearchRequest(BaseModel):
    query: str
    count: int = 8


@router.get("/status")
async def ai_status() -> dict:
    return copilot.status()


@router.post("/web-search")
async def ai_web_search(request: WebSearchRequest) -> dict:
    if not brave_search.configured:
        raise HTTPException(status_code=503, detail="Brave Search not configured")
    results = await brave_search.search(request.query, count=request.count)
    return {"query": request.query, "results": results, "provider": "brave"}


@router.post("/chat")
async def ai_chat(request: ChatRequest) -> dict:
    return await copilot.chat(
        messages=[m.model_dump() for m in request.messages],
        mode=request.mode,
        document_title=request.document_title,
        document_text=request.document_text,
        fields=request.fields,
        skill_id=request.skill_id,
        agreement_type=request.agreement_type,
    )


@router.post("/chat/stream")
async def ai_chat_stream(request: ChatRequest) -> StreamingResponse:
    """SSE stream: optional skill meta, then {delta}, then {done:true}."""

    async def events():
        try:
            async for event in copilot.chat_stream(
                messages=[m.model_dump() for m in request.messages],
                mode=request.mode,
                document_title=request.document_title,
                document_text=request.document_text,
                fields=request.fields,
                skill_id=request.skill_id,
                agreement_type=request.agreement_type,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

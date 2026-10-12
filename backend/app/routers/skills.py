"""Skill management API."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.skills import skill_registry

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillUpdateRequest(BaseModel):
    enabled: bool | None = None
    favorite: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)


@router.get("/plugins")
async def list_plugins() -> list[dict]:
    return skill_registry.plugins()


@router.get("")
async def list_skills(
    plugin: str | None = None,
    enabled_only: bool = Query(default=False),
    review_only: bool = Query(default=False),
) -> list[dict]:
    return skill_registry.list_skills(
        plugin=plugin,
        enabled_only=enabled_only,
        review_only=review_only,
    )


@router.post("/reindex")
async def reindex_skills() -> list[dict]:
    return skill_registry.refresh()


@router.get("/{skill_id:path}")
async def get_skill(skill_id: str, include_body: bool = Query(default=False)) -> dict:
    skill = skill_registry.get(skill_id, include_body=include_body)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@router.patch("/{skill_id:path}")
async def update_skill(skill_id: str, request: SkillUpdateRequest) -> dict:
    try:
        return skill_registry.update_skill(
            skill_id,
            enabled=request.enabled,
            favorite=request.favorite,
            notes=request.notes,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Skill not found") from exc


@router.post("/{skill_id:path}/toggle")
async def toggle_skill(skill_id: str) -> dict:
    skill = skill_registry.get(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill_registry.update_skill(skill_id, enabled=not skill["enabled"])

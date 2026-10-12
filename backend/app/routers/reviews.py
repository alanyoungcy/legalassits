"""Skill-guided review API."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.reviews import review_service

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewCreateRequest(BaseModel):
    contract_id: str
    skill_id: str | None = None
    side: str | None = Field(default="purchasing", description="purchasing | sales")


@router.get("")
async def list_reviews(contract_id: str | None = Query(default=None)) -> list[dict]:
    return review_service.list_reviews(contract_id=contract_id)


@router.post("")
async def create_review(request: ReviewCreateRequest) -> dict:
    try:
        return review_service.run(
            contract_id=request.contract_id,
            skill_id=request.skill_id,
            side=request.side,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{review_id}")
async def get_review(review_id: str) -> dict:
    review = review_service.get(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return review

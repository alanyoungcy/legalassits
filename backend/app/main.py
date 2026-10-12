"""Capco Contract Assists API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.models.schemas import HealthResponse
from app.routers import ai, contracts, documents, reviews, skills, templates
from app.services.catalog import catalog
from app.services.skills import skill_registry


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    settings.templates_dir.mkdir(parents=True, exist_ok=True)
    settings.contracts_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    catalog.refresh()
    skill_registry.refresh()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Capco Contract Assists with Capco Wayne copilot. Chat-first drafting, "
            "Word template yellow fields, upload-and-review, and commercial/employment skills."
        ),
        lifespan=lifespan,
    )
    origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz", response_model=HealthResponse)
    async def healthz() -> HealthResponse:
        return HealthResponse(
            status="ok",
            version=settings.app_version,
            product=settings.app_name,
            templates_indexed=len(catalog.list_templates()),
            copilot=settings.copilot_name,
            ai_configured=settings.ai_configured,
        )

    @app.get("/readyz")
    async def readyz() -> dict[str, str]:
        return {"status": "ready"}

    app.include_router(templates.router, prefix=settings.api_prefix)
    app.include_router(contracts.router, prefix=settings.api_prefix)
    app.include_router(skills.router, prefix=settings.api_prefix)
    app.include_router(reviews.router, prefix=settings.api_prefix)
    app.include_router(documents.router, prefix=settings.api_prefix)
    app.include_router(ai.router, prefix=settings.api_prefix)
    return app


app = create_app()

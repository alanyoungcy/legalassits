"""Application settings for Capco Contract Assists."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT / ".env"), str(ROOT / "backend" / ".env"), ".env"),
        extra="ignore",
    )

    app_name: str = "Capco Contract Assists"
    app_version: str = "0.1.0"
    api_prefix: str = "/api/v1"

    templates_dir: Path = Field(default=ROOT / "templates")
    data_dir: Path = Field(default=ROOT / "data")
    skills_vendor_dir: Path = Field(default=ROOT / "skills" / "vendor")
    skills_playbooks_dir: Path = Field(default=ROOT / "skills" / "playbooks")

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Capco Wayne — .env: API_KEY, BASE_URL, MODEL
    copilot_name: str = "Capco Wayne"
    api_key: str | None = None
    base_url: str = "https://api.openai.com/v1"
    model: str = "gpt-4o-mini"
    temperature: float = 0.2
    max_tokens: int = 2048

    # Brave Search API — Assessment mode web research
    brave_api_key: str | None = None
    brave_search_enabled: bool = True

    @computed_field  # type: ignore[prop-decorator]
    @property
    def contracts_dir(self) -> Path:
        return self.data_dir / "contracts"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def catalog_cache_path(self) -> Path:
        return self.data_dir / "template_catalog.json"

    @property
    def ai_configured(self) -> bool:
        return bool(self.api_key and self.api_key.strip())

    @property
    def brave_configured(self) -> bool:
        return bool(
            self.brave_search_enabled
            and self.brave_api_key
            and self.brave_api_key.strip()
        )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.templates_dir.mkdir(parents=True, exist_ok=True)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.contracts_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings

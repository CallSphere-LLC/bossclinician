"""Environment-driven settings. No secrets hardcoded; safe defaults for dev."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("bossclinician.ai")

APP_DIR = Path(__file__).resolve().parent
AI_DIR = APP_DIR.parent
DEFAULT_KB_PATH = AI_DIR / "knowledge" / "site.md"

DEFAULT_MODEL = "gpt-5.5-2026-04-23"

# Realtime (speech-to-speech) model for the site's voice agent. Separate from
# the text model: Realtime is its own family, billed per audio minute, and the
# browser never receives the API key — it gets a short-lived client secret
# minted by /realtime/session.
DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1"
DEFAULT_REALTIME_VOICE = "marin"

# Rough char budget for the knowledge base once it's folded into the system
# prompt. ~4 chars/token; keep headroom for persona + history + user turns.
DEFAULT_KB_MAX_CHARS = 24_000


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None
    openai_model: str
    realtime_model: str
    realtime_voice: str
    openai_base_url: str | None
    kb_path: Path
    kb_max_chars: int
    cors_allow_origins: list[str]

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)


def load_settings() -> Settings:
    api_key = os.environ.get("OPENAI_API_KEY") or None
    model = os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL
    realtime_model = os.environ.get("OPENAI_REALTIME_MODEL", DEFAULT_REALTIME_MODEL)
    realtime_voice = os.environ.get("OPENAI_REALTIME_VOICE", DEFAULT_REALTIME_VOICE)
    base_url = os.environ.get("OPENAI_BASE_URL") or None
    kb_path_str = os.environ.get("AI_KB_PATH")
    kb_path = Path(kb_path_str) if kb_path_str else DEFAULT_KB_PATH
    kb_max_chars = int(os.environ.get("AI_KB_MAX_CHARS", DEFAULT_KB_MAX_CHARS))

    origins_env = os.environ.get("CORS_ALLOW_ORIGINS", "*")
    cors_allow_origins = [o.strip() for o in origins_env.split(",") if o.strip()]

    if not api_key:
        logger.warning(
            "OPENAI_API_KEY is not set — /chat, /generate/blog, and "
            "/qualify-lead will return graceful canned fallbacks instead of "
            "calling the model. Set OPENAI_API_KEY to enable live responses."
        )

    return Settings(
        openai_api_key=api_key,
        openai_model=model,
        realtime_model=realtime_model,
        realtime_voice=realtime_voice,
        openai_base_url=base_url,
        kb_path=kb_path,
        kb_max_chars=kb_max_chars,
        cors_allow_origins=cors_allow_origins,
    )


settings = load_settings()

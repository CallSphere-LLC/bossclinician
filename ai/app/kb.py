"""Loads the pre-built `knowledge/site.md` digest for in-prompt grounding.

No vector DB: `site.md` is small enough (see build_kb.py) to fold directly
into the chat system prompt. We still apply a hard char-budget truncation
here as a safety net in case the digest grows, and log a warning so it's
never a silent truncation.
"""

from __future__ import annotations

import functools
import logging

from app.config import settings

logger = logging.getLogger("bossclinician.ai")

_FALLBACK_KB = (
    "# Boss Clinician\n\n"
    "Boss Clinician is Yvette Howard, LCSW's coaching brand for therapists "
    "and clinicians building independent private practices, centered on the "
    "B.O.S.S Blueprint, 1:1 coaching, courses, and a free masterclass. "
    "(Full knowledge base file was not found — this is a minimal fallback.)"
)


@functools.lru_cache(maxsize=1)
def load_knowledge_base() -> str:
    """Read and (if needed) truncate the site knowledge digest. Cached for
    the process lifetime — restart the service after re-running build_kb.py."""
    path = settings.kb_path
    if not path.exists():
        logger.warning("Knowledge base file not found at %s; using minimal fallback.", path)
        return _FALLBACK_KB

    text = path.read_text(encoding="utf-8")
    if len(text) > settings.kb_max_chars:
        logger.warning(
            "Knowledge base (%d chars) exceeds AI_KB_MAX_CHARS (%d); truncating.",
            len(text),
            settings.kb_max_chars,
        )
        text = text[: settings.kb_max_chars] + "\n\n[...truncated...]\n"
    return text

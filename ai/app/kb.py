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

# The heading build_kb.py writes for the section that must survive truncation.
GUARDRAIL_HEADING = "\n## Guardrail Facts"
ELISION = "\n\n[...knowledge base truncated to fit AI_KB_MAX_CHARS...]\n\n"

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
        text = _truncate(text, settings.kb_max_chars)
    return text


def _truncate(text: str, budget: int) -> str:
    """Trim the middle, not the end.

    build_kb.py puts the guardrail facts last, so a plain head truncation
    drops exactly the part the model most needs to respect (no guaranteed
    income, pricing on file may be stale, we don't bill insurance, the site
    disclaimer). Keep the head and that trailing section, and elide between
    them.
    """
    tail_start = text.rfind(GUARDRAIL_HEADING)
    tail = text[tail_start:] if tail_start != -1 else ""
    # A guardrail section large enough to crowd out the digest itself would be
    # its own bug; take the head half of the budget back if that ever happens.
    if len(tail) > budget // 2:
        tail = tail[: budget // 2]
    head = text[: budget - len(tail)]
    return head + ELISION + tail

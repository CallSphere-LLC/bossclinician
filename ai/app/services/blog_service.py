"""POST /generate/blog — SEO-aware blog draft generation in Yvette's voice."""

from __future__ import annotations

import logging

from app.config import settings
from app.models import BlogModelOutput, BlogRequest, BlogResponse
from app.openai_client import CallTimer, get_client, log_usage
from app.prompts import load_prompt

logger = logging.getLogger("bossclinician.ai")

ENDPOINT = "generate_blog"
MAX_ATTEMPTS = 2

FALLBACK_RESPONSE = BlogResponse(
    title="Building a Private Practice That Actually Supports Your Life",
    excerpt=(
        "A look at why more sessions isn't the answer to a more profitable "
        "practice — and what to focus on instead."
    ),
    bodyMd=(
        "## The content generator is temporarily in limited mode\n\n"
        "We couldn't reach the writing model just now, so here's a stand-in "
        "outline instead of a full draft. Please try again shortly, or "
        "check `OPENAI_API_KEY` if this persists.\n\n"
        "- Clarify your ideal client and niche\n"
        "- Package your services with pricing that reflects your expertise\n"
        "- Shift toward private pay where it makes sense for your practice\n"
        "- Build at least one income stream beyond the therapy hour\n"
    ),
    tags=["boss clinician", "private practice"],
)


def _build_instructions() -> str:
    return load_prompt("blog_system.md")


def _build_input(request: BlogRequest) -> str:
    parts = [f"Topic: {request.topic}"]
    if request.tone:
        parts.append(f"Tone: {request.tone}")
    if request.keywords:
        parts.append(f"Keywords to weave in naturally: {', '.join(request.keywords)}")
    return "\n".join(parts)


async def run_generate_blog(request: BlogRequest) -> BlogResponse:
    if not settings.openai_configured:
        return FALLBACK_RESPONSE

    client = get_client()
    instructions = _build_instructions()
    input_text = _build_input(request)

    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with CallTimer(ENDPOINT) as timer:
                response = await client.responses.parse(
                    model=settings.openai_model,
                    instructions=instructions,
                    input=input_text,
                    text_format=BlogModelOutput,
                )
            log_usage(
                endpoint=ENDPOINT,
                model=settings.openai_model,
                usage=response.usage,
                latency_ms=timer.elapsed_ms(),
            )
            parsed = response.output_parsed
            if parsed is None:
                raise ValueError("Model returned no parsed output (possible refusal).")
            return BlogResponse(
                title=parsed.title,
                excerpt=parsed.excerpt,
                bodyMd=parsed.bodyMd,
                tags=parsed.tags,
            )
        except Exception as exc:  # noqa: BLE001 - bounded retry, then safe fallback
            last_error = exc
            logger.warning("generate/blog structured-output attempt %d/%d failed: %s", attempt, MAX_ATTEMPTS, exc)

    logger.error("generate/blog: all %d attempts failed, returning fallback. last_error=%s", MAX_ATTEMPTS, last_error)
    return FALLBACK_RESPONSE

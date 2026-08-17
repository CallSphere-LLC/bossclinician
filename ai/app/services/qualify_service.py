"""POST /qualify-lead — score fit for 1:1 Boss Clinician coaching."""

from __future__ import annotations

import logging

from app.config import settings
from app.models import QualifyModelOutput, QualifyRequest, QualifyResponse
from app.openai_client import CallTimer, get_client, log_usage
from app.prompts import load_prompt

logger = logging.getLogger("bossclinician.ai")

ENDPOINT = "qualify_lead"
MAX_ATTEMPTS = 2

FALLBACK_RESPONSE = QualifyResponse(
    score=50,
    summary=(
        "Unable to reach the scoring model right now, so this is a neutral "
        "placeholder score — please review this application manually."
    ),
)


def _build_instructions() -> str:
    return load_prompt("qualify_system.md")


async def run_qualify_lead(request: QualifyRequest) -> QualifyResponse:
    if not settings.openai_configured:
        return FALLBACK_RESPONSE

    client = get_client()
    instructions = _build_instructions()

    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with CallTimer(ENDPOINT) as timer:
                response = await client.responses.parse(
                    model=settings.openai_model,
                    instructions=instructions,
                    input=request.text,
                    text_format=QualifyModelOutput,
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
            return QualifyResponse(score=parsed.score, summary=parsed.summary)
        except Exception as exc:  # noqa: BLE001 - bounded retry, then safe fallback
            last_error = exc
            logger.warning("qualify-lead structured-output attempt %d/%d failed: %s", attempt, MAX_ATTEMPTS, exc)

    logger.error("qualify-lead: all %d attempts failed, returning fallback. last_error=%s", MAX_ATTEMPTS, last_error)
    return FALLBACK_RESPONSE

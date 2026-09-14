"""Shared AsyncOpenAI client + usage/latency logging helper."""

from __future__ import annotations

import functools
import logging
import time
from dataclasses import dataclass
from typing import Any, Self

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger("bossclinician.ai")

DEFAULT_BASE_URL = "https://api.openai.com/v1"


@functools.lru_cache(maxsize=1)
def get_client() -> AsyncOpenAI:
    # Always pass base_url. Left unset, the SDK reads OPENAI_BASE_URL itself,
    # and the blank `OPENAI_BASE_URL=` line from .env.example would give it an
    # empty base URL and break every call.
    return AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or DEFAULT_BASE_URL,
    )


@dataclass
class CallTimer:
    endpoint: str
    _start: float = 0.0

    def __enter__(self) -> Self:
        self._start = time.monotonic()
        return self

    def __exit__(self, *exc: object) -> None:
        pass

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self._start) * 1000)


def log_usage(*, endpoint: str, model: str, usage: Any, latency_ms: int) -> None:
    """Log cost/latency observability for a single LLM call.

    `usage` is the SDK's usage object (Responses API `response.usage` or
    Chat Completions `completion.usage`); field names differ slightly across
    APIs so we probe defensively.
    """
    input_tokens = getattr(usage, "input_tokens", None) or getattr(usage, "prompt_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None) or getattr(usage, "completion_tokens", None)
    cached_tokens = None
    details = getattr(usage, "input_tokens_details", None) or getattr(usage, "prompt_tokens_details", None)
    if details is not None:
        cached_tokens = getattr(details, "cached_tokens", None)

    logger.info(
        "llm_call endpoint=%s model=%s input_tokens=%s output_tokens=%s "
        "cached_tokens=%s latency_ms=%d",
        endpoint,
        model,
        input_tokens,
        output_tokens,
        cached_tokens,
        latency_ms,
    )

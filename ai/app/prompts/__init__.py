"""Prompt files live as plain markdown next to this module — never inline in
business logic — and are loaded (and cached) via `load_prompt`."""

from __future__ import annotations

import functools
from pathlib import Path

_PROMPTS_DIR = Path(__file__).resolve().parent


@functools.cache
def load_prompt(name: str) -> str:
    path = _PROMPTS_DIR / name
    return path.read_text(encoding="utf-8").strip()

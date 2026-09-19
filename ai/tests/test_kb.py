"""The knowledge-base digest and its char budget.

The shipped `knowledge/site.md` is already larger than the default budget, so
truncation is not a hypothetical safety net here — it runs on every chat turn.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import pytest

from app import kb
from app.config import DEFAULT_KB_MAX_CHARS, DEFAULT_KB_PATH, settings


def _load_with(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> str:
    monkeypatch.setattr(kb, "settings", dataclasses.replace(settings, **overrides))
    kb.load_knowledge_base.cache_clear()
    try:
        return kb.load_knowledge_base()
    finally:
        kb.load_knowledge_base.cache_clear()


def test_shipped_digest_keeps_its_guardrails_within_the_default_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # site.md is ~39k chars against a 24k budget: head truncation dropped the
    # whole "Guardrail Facts" section (it is written last), so the model was
    # grounded on the marketing copy with none of the rules attached to it.
    shipped = len(DEFAULT_KB_PATH.read_text(encoding="utf-8"))
    text = _load_with(monkeypatch, kb_path=DEFAULT_KB_PATH, kb_max_chars=DEFAULT_KB_MAX_CHARS)

    assert "## Guardrail Facts" in text
    assert "never promise specific income or outcomes" in text
    assert "# Boss Clinician — Site Knowledge Base" in text  # head survives too
    assert len(text) <= DEFAULT_KB_MAX_CHARS + len(kb.ELISION)
    if shipped > DEFAULT_KB_MAX_CHARS:
        assert kb.ELISION in text


def test_truncation_keeps_head_and_guardrail_tail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    digest = "# Head\n" + ("filler line\n" * 500) + "\n## Guardrail Facts (always respect)\n- never guarantee income\n"
    path = tmp_path / "site.md"
    path.write_text(digest, encoding="utf-8")
    budget = 1_000
    assert len(digest) > budget

    text = _load_with(monkeypatch, kb_path=path, kb_max_chars=budget)

    assert text.startswith("# Head\n")
    assert text.endswith("- never guarantee income\n")
    assert len(text) <= budget + len(kb.ELISION)


def test_truncation_without_a_guardrail_section_still_fits_the_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "site.md"
    path.write_text("# Head\n" + ("filler line\n" * 500), encoding="utf-8")

    text = _load_with(monkeypatch, kb_path=path, kb_max_chars=1_000)

    assert text.startswith("# Head\n")
    assert len(text) <= 1_000 + len(kb.ELISION)


def test_missing_file_falls_back_instead_of_raising(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = _load_with(monkeypatch, kb_path=tmp_path / "nope.md")
    assert text == kb._FALLBACK_KB

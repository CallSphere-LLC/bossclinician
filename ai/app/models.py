"""Pydantic v2 request/response models.

Field names are camelCase on purpose (not idiomatic Python) so the JSON
wire format matches the AI service contract in ARCHITECTURE.md exactly —
no alias plumbing needed, no drift risk between attribute and JSON key.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    sessionId: str
    message: str
    history: list[ChatHistoryMessage] | None = None


class ChatResponse(BaseModel):
    reply: str
    suggestions: list[str] = Field(default_factory=list)
    leadSignal: bool = False


class BlogRequest(BaseModel):
    topic: str
    tone: str | None = None
    keywords: list[str] | None = None


class BlogResponse(BaseModel):
    title: str
    excerpt: str
    bodyMd: str
    tags: list[str] = Field(default_factory=list)


class QualifyRequest(BaseModel):
    text: str


class QualifyResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    summary: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


# --- Internal structured-output schemas (what we ask the model to fill in).
# Kept separate from the wire response models above so we can evolve the
# LLM-facing schema (e.g. add reasoning fields) without touching the API
# contract.


class ChatModelOutput(BaseModel):
    """Structured output requested from the model for /chat."""

    reply: str = Field(description="The concierge's reply to the user, in Yvette's warm, direct coach voice.")
    suggestions: list[str] = Field(
        description="2-4 short, helpful follow-up prompts the user could tap next.",
        min_length=2,
        max_length=4,
    )
    leadSignal: bool = Field(
        description="True if the user is expressing buying/booking/application intent (ready to apply, book a call, enroll, or asks about pricing/next steps with clear interest)."
    )


class BlogModelOutput(BaseModel):
    """Structured output requested from the model for /generate/blog."""

    title: str = Field(description="SEO-aware, compelling blog title.")
    excerpt: str = Field(description="1-2 sentence teaser/meta-description.")
    bodyMd: str = Field(description="Full blog post body in well-structured markdown (headings, lists), ~700-1000 words.")
    tags: list[str] = Field(description="3-6 short topical tags.", min_length=1, max_length=8)


class QualifyModelOutput(BaseModel):
    """Structured output requested from the model for /qualify-lead."""

    score: int = Field(ge=0, le=100, description="Fit score for 1:1 Boss Clinician coaching, 0-100.")
    summary: str = Field(description="2-3 sentence rationale for the score, referencing concrete signals from the text.")


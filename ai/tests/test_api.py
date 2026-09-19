"""Smoke tests for the no-API-key fallback paths (the common dev-without-secrets
case). These intentionally do NOT call OpenAI — see README for eval-style
checks to run manually against a live key before shipping prompt changes."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import models
from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_fallback_shape() -> None:
    response = client.post("/chat", json={"sessionId": "s1", "message": "hi"})
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["reply"], str) and body["reply"]
    assert isinstance(body["suggestions"], list)
    assert isinstance(body["leadSignal"], bool)


def test_chat_with_history() -> None:
    response = client.post(
        "/chat",
        json={
            "sessionId": "s1",
            "message": "What about pricing?",
            "history": [
                {"role": "user", "content": "Tell me about coaching"},
                {"role": "assistant", "content": "Sure, here's an overview..."},
            ],
        },
    )
    assert response.status_code == 200


def test_generate_blog_fallback_shape() -> None:
    response = client.post("/generate/blog", json={"topic": "raising your rates"})
    assert response.status_code == 200
    body = response.json()
    assert {"title", "excerpt", "bodyMd", "tags"} <= body.keys()


def test_qualify_lead_fallback_shape() -> None:
    response = client.post("/qualify-lead", json={"text": "I'm an LCSW ready to scale."})
    assert response.status_code == 200
    body = response.json()
    assert 0 <= body["score"] <= 100
    assert isinstance(body["summary"], str) and body["summary"]


def test_oversized_chat_message_is_rejected_not_sent_to_the_model() -> None:
    # No cap at all meant an arbitrarily large body walked straight into a
    # billed model call; the backend's own limit is 4000 chars.
    response = client.post(
        "/chat",
        json={"sessionId": "s1", "message": "x" * (models.MAX_MESSAGE_CHARS + 1)},
    )
    assert response.status_code == 422


def test_chat_message_at_the_backend_limit_is_accepted() -> None:
    response = client.post(
        "/chat", json={"sessionId": "s1", "message": "x" * models.MAX_MESSAGE_CHARS}
    )
    assert response.status_code == 200


def test_oversized_chat_history_is_rejected() -> None:
    long_line = {"role": "user", "content": "x" * (models.MAX_HISTORY_CONTENT_CHARS + 1)}
    assert (
        client.post(
            "/chat", json={"sessionId": "s1", "message": "hi", "history": [long_line]}
        ).status_code
        == 422
    )
    many = [{"role": "user", "content": "hi"}] * (models.MAX_HISTORY_MESSAGES + 1)
    assert (
        client.post(
            "/chat", json={"sessionId": "s1", "message": "hi", "history": many}
        ).status_code
        == 422
    )


def test_oversized_qualify_text_is_rejected() -> None:
    response = client.post(
        "/qualify-lead", json={"text": "x" * (models.MAX_QUALIFY_CHARS + 1)}
    )
    assert response.status_code == 422


def test_oversized_blog_request_is_rejected() -> None:
    assert (
        client.post(
            "/generate/blog", json={"topic": "x" * (models.MAX_TOPIC_CHARS + 1)}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/generate/blog",
            json={"topic": "rates", "keywords": ["k"] * (models.MAX_KEYWORDS + 1)},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/generate/blog",
            json={"topic": "rates", "keywords": ["k" * (models.MAX_KEYWORD_CHARS + 1)]},
        ).status_code
        == 422
    )


def test_blog_request_at_the_backend_limits_is_accepted() -> None:
    response = client.post(
        "/generate/blog",
        json={
            "topic": "x" * 300,
            "tone": "warm",
            "keywords": ["k" * models.MAX_KEYWORD_CHARS],
        },
    )
    assert response.status_code == 200

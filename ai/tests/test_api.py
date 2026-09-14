"""Smoke tests for the no-API-key fallback paths (the common dev-without-secrets
case). These intentionally do NOT call OpenAI — see README for eval-style
checks to run manually against a live key before shipping prompt changes."""

from __future__ import annotations

from fastapi.testclient import TestClient

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


def test_realtime_session_without_key_is_503() -> None:
    response = client.post("/realtime/session")
    assert response.status_code == 503
    assert "OPENAI_API_KEY" in response.json()["detail"]

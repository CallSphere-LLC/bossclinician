"""The with-API-key paths, against a mocked OpenAI.

No network and no real key: the SDK's HTTP client is given an httpx2
MockTransport, so these prove what the service sends (endpoint, auth, model,
instructions, input, structured-output schema) and how it reads the reply,
including the retry-once-then-fallback behaviour."""

from __future__ import annotations

import dataclasses
import functools
import json
import logging
from typing import Any, Iterator

import httpx2
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI

from app import openai_client
from app.config import settings
from app.main import app
from app.services import blog_service, chat_service, qualify_service

client = TestClient(app)

GATEWAY = "http://gateway.test/v1"
# Every module that did `from app.config import settings`.
SETTINGS_MODULES = (openai_client, chat_service, blog_service, qualify_service)


class FakeOpenAI:
    """Records each request the service makes and answers with one canned response."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []
        self._status = 400
        self._kwargs: dict[str, Any] = {"json": {"error": {"message": "no reply configured"}}}

    def respond(self, status: int = 200, **kwargs: Any) -> None:
        self._status, self._kwargs = status, kwargs

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return httpx2.Response(self._status, **self._kwargs)


def _responses_body(content: list[dict[str, Any]]) -> dict[str, Any]:
    """A Responses API body carrying one assistant message."""
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1_760_000_000,
        "model": settings.openai_model,
        "status": "completed",
        "output": [
            {"type": "message", "id": "msg_test", "status": "completed", "role": "assistant", "content": content}
        ],
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
        "usage": {
            "input_tokens": 11,
            "input_tokens_details": {"cached_tokens": 3},
            "output_tokens": 7,
            "output_tokens_details": {"reasoning_tokens": 0},
            "total_tokens": 18,
        },
    }


def _structured_reply(payload: dict[str, Any]) -> dict[str, Any]:
    return _responses_body([{"type": "output_text", "text": json.dumps(payload), "annotations": []}])


@pytest.fixture
def fake_openai(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeOpenAI]:
    """Configure a key and gateway URL, and route the SDK's requests to a FakeOpenAI."""
    fake = FakeOpenAI()
    live = dataclasses.replace(settings, openai_api_key="sk-test", openai_base_url=GATEWAY)
    for module in SETTINGS_MODULES:
        monkeypatch.setattr(module, "settings", live)
    # get_client() still builds the client from settings; only the transport is fake.
    mock_http = httpx2.AsyncClient(transport=httpx2.MockTransport(fake.handle))
    monkeypatch.setattr(openai_client, "AsyncOpenAI", functools.partial(AsyncOpenAI, http_client=mock_http))
    openai_client.get_client.cache_clear()
    yield fake
    openai_client.get_client.cache_clear()


def test_client_ignores_blank_base_url_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # .env.example ships `OPENAI_BASE_URL=`; the SDK would take that as "".
    monkeypatch.setenv("OPENAI_BASE_URL", "")
    monkeypatch.setattr(openai_client, "settings", dataclasses.replace(settings, openai_api_key="sk-test"))
    openai_client.get_client.cache_clear()
    try:
        assert str(openai_client.get_client().base_url) == "https://api.openai.com/v1/"
    finally:
        openai_client.get_client.cache_clear()


def test_chat_sends_structured_request_and_returns_parsed_reply(
    fake_openai: FakeOpenAI, caplog: pytest.LogCaptureFixture
) -> None:
    fake_openai.respond(
        json=_structured_reply(
            {"reply": "Happy to help.", "suggestions": ["What does coaching cost?", "How do I apply?"], "leadSignal": True}
        )
    )
    history = [
        {"role": "user", "content": "Tell me about coaching"},
        {"role": "assistant", "content": "Sure, here's an overview..."},
    ]
    with caplog.at_level(logging.INFO, logger="bossclinician.ai"):
        response = client.post("/chat", json={"sessionId": "s1", "message": "How do I apply?", "history": history})

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Happy to help.",
        "suggestions": ["What does coaching cost?", "How do I apply?"],
        "leadSignal": True,
    }

    [request] = fake_openai.requests
    assert request.method == "POST"
    assert str(request.url) == f"{GATEWAY}/responses"
    assert request.headers["authorization"] == "Bearer sk-test"
    body = json.loads(request.content)
    assert body["model"] == settings.openai_model
    assert "# Site Knowledge Base" in body["instructions"]
    assert body["input"] == [*history, {"role": "user", "content": "How do I apply?"}]
    text_format = body["text"]["format"]
    assert text_format["type"] == "json_schema"
    assert text_format["strict"] is True
    assert text_format["name"] == "ChatModelOutput"
    assert set(text_format["schema"]["required"]) == {"reply", "suggestions", "leadSignal"}

    assert "llm_call endpoint=chat" in caplog.text
    assert "input_tokens=11 output_tokens=7 cached_tokens=3" in caplog.text


def test_generate_blog_parses_structured_reply(fake_openai: FakeOpenAI) -> None:
    draft = {"title": "Raise Your Rates", "excerpt": "Why and how.", "bodyMd": "## Start here", "tags": ["pricing"]}
    fake_openai.respond(json=_structured_reply(draft))

    response = client.post("/generate/blog", json={"topic": "raising your rates", "keywords": ["private pay"]})

    assert response.status_code == 200
    assert response.json() == draft
    [request] = fake_openai.requests
    body = json.loads(request.content)
    assert body["input"] == "Topic: raising your rates\nKeywords to weave in naturally: private pay"
    assert body["text"]["format"]["name"] == "BlogModelOutput"


def test_qualify_lead_parses_structured_reply(fake_openai: FakeOpenAI) -> None:
    fake_openai.respond(json=_structured_reply({"score": 82, "summary": "Licensed and ready for private pay."}))

    response = client.post("/qualify-lead", json={"text": "LPC, 3 years in, leaving Headway."})

    assert response.status_code == 200
    assert response.json() == {"score": 82, "summary": "Licensed and ready for private pay."}
    [request] = fake_openai.requests
    body = json.loads(request.content)
    assert body["input"] == "LPC, 3 years in, leaving Headway."
    assert body["text"]["format"]["name"] == "QualifyModelOutput"


def test_refusal_retries_once_then_falls_back(fake_openai: FakeOpenAI) -> None:
    fake_openai.respond(json=_responses_body([{"type": "refusal", "refusal": "I can't help with that."}]))

    response = client.post("/qualify-lead", json={"text": "anything"})

    assert response.status_code == 200
    assert response.json() == qualify_service.FALLBACK_RESPONSE.model_dump()
    assert len(fake_openai.requests) == qualify_service.MAX_ATTEMPTS


def test_api_error_retries_once_then_falls_back(fake_openai: FakeOpenAI) -> None:
    # 400 is not retried inside the SDK, so each attempt is exactly one request.
    fake_openai.respond(400, json={"error": {"message": "Unknown model", "type": "invalid_request_error"}})

    response = client.post("/chat", json={"sessionId": "s1", "message": "hi"})

    assert response.status_code == 200
    assert response.json() == chat_service.FALLBACK_RESPONSE.model_dump()
    assert len(fake_openai.requests) == chat_service.MAX_ATTEMPTS


# Boss Clinician — AI Service

FastAPI microservice providing the coaching-concierge chatbot and content
generation for the Boss Clinician site (Yvette Howard, LCSW). Internal
service — only the Node/Express `backend` calls it; the browser never talks
to this service directly (see `../ARCHITECTURE.md`, "AI service contract").

## Endpoints

| Method | Path             | Purpose                                                   |
|--------|------------------|------------------------------------------------------------|
| GET    | `/health`        | `{status:"ok"}`                                            |
| POST   | `/chat`          | `{sessionId, message, history?}` → `{reply, suggestions[], leadSignal}` |
| POST   | `/generate/blog` | `{topic, tone?, keywords?}` → `{title, excerpt, bodyMd, tags[]}` |
| POST   | `/qualify-lead`  | `{text}` → `{score, summary}`                              |

All request/response field names are **camelCase** to match the JSON
contract in `ARCHITECTURE.md` exactly (see `app/models.py`).

## How it works

- **Structured outputs, not regex parsing.** Every LLM call uses the OpenAI
  Responses API's `client.responses.parse(..., text_format=SomePydanticModel)`
  so the model's reply, suggestions, lead signal, blog fields, or qualify
  score/summary come back already validated. On a parse failure/refusal we
  retry once, then fall back to a safe canned response — we never crash the
  request and never loop unboundedly.
- **No API key? No crash.** If `OPENAI_API_KEY` is unset, every endpoint
  logs a warning at startup and returns a graceful static fallback
  (`app/services/*_service.py::FALLBACK_RESPONSE`) so the rest of the stack
  (backend, frontend, docker-compose) still boots and is exercisable in dev
  without secrets.
- **Prompts are files, not inline strings.** See `app/prompts/*.md`:
  `chat_system.md` (persona + guardrails), `blog_system.md`, `qualify_system.md`.
  Loaded + cached via `app/prompts/__init__.py::load_prompt`.
- **Knowledge base is in-prompt, no vector DB.** `build_kb.py` reads
  `../shared/content.json` (the scraped site content) and writes
  `knowledge/site.md` — a deduplicated, boilerplate-stripped markdown digest
  (offer, pillars, 1:1 coaching detail, courses, free resources, condensed
  blog highlights, contact info, guardrail facts pulled from the site's own
  disclaimer). The chat service folds the whole file into the model's
  `instructions` alongside the persona prompt. `app/kb.py` applies a hard
  char-budget truncation (`AI_KB_MAX_CHARS`, default ~24k chars) as a safety
  net and logs a warning if it ever has to truncate — simple and robust
  rather than a RAG pipeline, appropriate for a single-digest marketing site.
- **Observability.** `app/openai_client.py::log_usage` logs
  `endpoint, model, input_tokens, output_tokens, cached_tokens, latency_ms`
  for every model call (fields probed defensively across Responses/Chat
  Completions usage shapes).

## Rebuilding the knowledge base

Whenever `shared/content.json` changes (re-scrape, new blog post, updated
pricing/copy):

```bash
cd ai
python build_kb.py     # writes knowledge/site.md
```

Commit the regenerated `knowledge/site.md` — it's checked in so the service
boots without needing `shared/` at runtime (the Docker image doesn't include
`shared/`; `build_kb.py` is a dev-time tool only). Restart the service after
regenerating so the new digest is picked up (it's cached for the process
lifetime via `functools.lru_cache`).

## Local dev

```bash
cd ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in OPENAI_API_KEY to get live responses
uvicorn app.main:app --reload --port 8000
```

Without `OPENAI_API_KEY` set, all three POST endpoints still respond (with
canned fallbacks) — useful for `docker-compose up` in dev.

## Tests

```bash
pytest tests/ -q
```

`tests/test_api.py` smoke-tests the no-API-key fallback paths.
`tests/test_live_paths.py` covers the with-key paths against a mocked OpenAI
(an httpx2 `MockTransport`): the request each endpoint sends, parsing the
structured reply, retry-then-fallback on a refusal or API error, and minting
a Realtime client secret. Both are deterministic, with no network or cost, and
neither checks what the model actually says. Before shipping a **prompt change** (`app/prompts/*.md`),
manually exercise the live endpoints with a real `OPENAI_API_KEY` and sanity
check a handful of representative inputs per endpoint — e.g.:

```bash
curl -s localhost:8000/chat -H 'content-type: application/json' \
  -d '{"sessionId":"t1","message":"I am on Talkspace and burned out, what now?"}' | jq

curl -s localhost:8000/qualify-lead -H 'content-type: application/json' \
  -d '{"text":"Licensed LPC 3 years in, ready to leave Headway and go private pay."}' | jq

curl -s localhost:8000/generate/blog -H 'content-type: application/json' \
  -d '{"topic":"psychology today profile tips","keywords":["psychology today","directory profile"]}' | jq
```

Watch the logs for the `llm_call ...` line to confirm token usage/latency
look sane before considering the change shipped.

## Env vars

See `.env.example`:

- `OPENAI_API_KEY` — required for live responses; omitted → graceful fallbacks.
- `OPENAI_MODEL` — default `gpt-5.5-2026-04-23`.
- `OPENAI_BASE_URL` — optional, only for a proxy/gateway in front of OpenAI.
  Blank means the default `https://api.openai.com/v1`.
- `AI_KB_PATH`, `AI_KB_MAX_CHARS`, `CORS_ALLOW_ORIGINS` — optional overrides,
  sensible defaults in `app/config.py`.

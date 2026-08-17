"""Mints short-lived client secrets for the browser's Realtime voice session.

The browser needs a credential to open a WebRTC connection straight to OpenAI,
but it must never see ``OPENAI_API_KEY``. So the key stays here and this module
exchanges it for an ephemeral secret that expires in about a minute — long
enough to establish the connection, useless if intercepted afterwards.

The session is created with the site's tool set already attached, so the voice
agent can navigate the visitor around the site mid-conversation.
"""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger("bossclinician.ai")

OPENAI_REALTIME_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"

# Routes the agent is allowed to send someone to. Declared as an enum on the
# tool so the model cannot invent a path that 404s — a hallucinated URL is a
# dead end for the visitor, and voice gives them no address bar to recover with.
SITE_PAGES: dict[str, str] = {
    "/": "Home — the overview of Boss Clinician and the three offers.",
    "/about": "About Yvette Howard, LCSW — her story and credentials.",
    "/work-with-me": "The coaching offers: Boss Clinician Club, Lounge, and the Boardroom mastermind.",
    "/courses": "The training library — self-paced courses and toolkits.",
    "/resource-hub": "Free resource hub, including the income calculator.",
    "/resources": "Free resources: the masterclass and the Practice Reset Planner.",
    "/retreats": "Boss Clinician retreats.",
    "/store": "Done-with-you consulting services and their prices.",
    "/practice-reset-planner": "The free 30-day Practice Reset Planner.",
    "/practice-quiz": "The free 2-minute practice quiz.",
    "/blog": "Articles on building a private practice.",
    "/apply": "The application form for working with Yvette.",
    "/contact": "Contact page and booking a call.",
}

INSTRUCTIONS = """You are the Boss Clinician assistant — the voice of Yvette \
Howard, LCSW's practice-coaching business. You help therapists and clinicians \
who are building, scaling, or escaping platform work (Alma, Headway, \
Talkspace) find the right next step.

How to behave:
- Be warm, direct and concise. This is a spoken conversation: two or three \
sentences per turn, not paragraphs. Never read out a list of more than three \
items.
- You are talking to a clinician, not a patient. Never give clinical, medical, \
legal or tax advice, and never discuss anyone's personal health information.
- When the visitor expresses interest in something that lives on a page, CALL \
THE navigate_to_page TOOL to take them there, then keep talking about it. Do \
not just describe a page — open it. Say briefly what you are doing, e.g. \
"Let me pull that up for you."
- Navigate as soon as the intent is clear. If someone says they are fully \
booked and capped, open /work-with-me and talk about the Lounge. If they ask \
about pricing for done-with-you work, open /store.
- Only ever claim what is actually on the site. If you do not know a price, a \
date or a detail, say so and offer to point them at the contact page rather \
than guessing.
- If someone wants to speak to Yvette or is ready to commit, take them to \
/apply or /contact."""


def _tools() -> list[dict]:
    return [
        {
            "type": "function",
            "name": "navigate_to_page",
            "description": (
                "Open a page of the Boss Clinician website in the visitor's browser. "
                "Use this whenever the visitor's interest maps to a page, so they see "
                "it while you keep talking. Do not describe a page without opening it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "enum": list(SITE_PAGES.keys()),
                        "description": "The site path to open.",
                    },
                    "reason": {
                        "type": "string",
                        "description": "One short phrase telling the visitor why, e.g. 'the Lounge details'.",
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
        {
            "type": "function",
            "name": "list_site_pages",
            "description": (
                "List the pages available on the site with a one-line description of each. "
                "Use when unsure which page answers the visitor's question."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    ]


def _page_catalogue() -> str:
    return "\n".join(f"{path} — {desc}" for path, desc in SITE_PAGES.items())


async def create_realtime_session() -> dict:
    """Return ``{clientSecret, expiresAt, model, voice}`` for the browser.

    Raises RuntimeError with a readable message on any failure so the widget can
    fall back to text chat rather than silently offering a dead microphone.
    """
    if not settings.openai_configured:
        raise RuntimeError("OPENAI_API_KEY is not configured on the AI service")

    payload = {
        "session": {
            "type": "realtime",
            "model": settings.realtime_model,
            "audio": {"output": {"voice": settings.realtime_voice}},
            "instructions": f"{INSTRUCTIONS}\n\nPages you can open:\n{_page_catalogue()}",
            "tools": _tools(),
            "tool_choice": "auto",
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                OPENAI_REALTIME_SECRETS_URL,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.exception("realtime session request failed")
        raise RuntimeError(f"Could not reach OpenAI Realtime: {exc}") from exc

    if res.status_code >= 400:
        # Surface the provider's message: the most likely failures here are a
        # key without Realtime access or an unknown model id, and both are
        # invisible unless the reason is passed through.
        detail = res.text[:400]
        logger.error("realtime session rejected (%s): %s", res.status_code, detail)
        raise RuntimeError(f"OpenAI rejected the Realtime session ({res.status_code}): {detail}")

    data = res.json()
    secret = data.get("value") or (data.get("client_secret") or {}).get("value")
    if not secret:
        raise RuntimeError("Realtime response contained no client secret")

    return {
        "clientSecret": secret,
        "expiresAt": data.get("expires_at") or (data.get("client_secret") or {}).get("expires_at"),
        "model": settings.realtime_model,
        "voice": settings.realtime_voice,
    }

"""Boss Clinician AI microservice — FastAPI entrypoint.

Internal service, called only by the Node/Express backend (browser never
calls this directly). See ARCHITECTURE.md's "AI service contract".
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models import (
    BlogRequest,
    BlogResponse,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    QualifyRequest,
    QualifyResponse,
)
from app.services.blog_service import run_generate_blog
from app.services.chat_service import run_chat
from app.services.qualify_service import run_qualify_lead

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bossclinician.ai")

app = FastAPI(title="Boss Clinician AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    return await run_chat(request)


@app.post("/generate/blog", response_model=BlogResponse)
async def generate_blog(request: BlogRequest) -> BlogResponse:
    return await run_generate_blog(request)


@app.post("/qualify-lead", response_model=QualifyResponse)
async def qualify_lead(request: QualifyRequest) -> QualifyResponse:
    return await run_qualify_lead(request)


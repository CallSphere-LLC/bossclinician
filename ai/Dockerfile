FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY knowledge ./knowledge

# Run as a non-root user. uvicorn is installed globally on PATH, so the
# non-root HOME change doesn't affect startup.
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
# build_kb.py is a dev-time tool that reads ../shared/content.json (outside
# this build context) and is not needed at runtime — knowledge/site.md is
# generated + committed ahead of time. Re-run it locally and rebuild if
# shared/content.json changes.

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

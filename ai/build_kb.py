#!/usr/bin/env python3
"""Build ai/knowledge/site.md from shared/content.json.

Reads the scraped Boss Clinician site content and produces a clean,
deduplicated markdown digest that the chat endpoint loads (in-prompt,
no vector DB) as grounding for the coaching-concierge chatbot.

Run:
    python build_kb.py

Re-run any time shared/content.json changes; the output is committed
so the service can boot without re-running this script.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

AI_DIR = Path(__file__).resolve().parent
ROOT_DIR = AI_DIR.parent
CONTENT_JSON = ROOT_DIR / "shared" / "content.json"
OUTPUT_MD = AI_DIR / "knowledge" / "site.md"

# Page slugs to digest, in the order they should appear, with a short
# section title. Pure-legal boilerplate pages (privacy-policy, terms-of-use,
# financialdisclaimer) are intentionally excluded from the narrative digest;
# only the one guardrail-relevant fact from `disclaimer` is pulled in below.
PAGE_ORDER: list[tuple[str, str]] = [
    ("home", "Homepage — The Offer at a Glance"),
    ("about_yvette", "About Yvette Howard, LCSW"),
    ("work-with-me", "1:1 Coaching — Boss Clinician Consulting"),
    ("all-courses", "Courses & Digital Resources Library"),
    ("resources", "Free Resources & The Masterclass"),
    ("apply", "How to Apply for 1:1 Coaching"),
    ("store", "Consulting Packages & Pricing (as scraped)"),
    ("quiz", "Private Practice Readiness Quiz"),
    ("contact", "Contact & Membership / Program Notes"),
]

BLOG_PREFIX = "blog_"

# Exact-match boilerplate lines (nav, footer, repeated CTAs) to drop.
# Compared case-insensitively after whitespace collapse.
BOILERPLATE = {
    "about yvette", "work with me", "courses", "free resources", "retreats",
    "blog", "home", "about", "podcast", "top resources", "contact", "log in",
    "financial disclaimer", "privacy policy", "terms of use", "disclaimer",
    "terms of service", "join our free trial",
    "get started today before this once in a lifetime opportunity expires.",
    "follow", "follow me", "google", "grab your bundle",
    "download free guide", "let's work together", "learn more about brighter tomorrow",
    "(brighter tomorrow therapy)",
}

MIN_CHARS = 4  # drop near-empty fragments (stray labels, numbers, arrows)

# Substrings (lowercased) that mark scrape contamination unrelated to Boss
# Clinician (e.g. a leftover Kajabi login-support template referencing a
# different creator's support email) — never let these leak into the KB,
# since a wrong contact email is worse than a missing one.
NOISE_SUBSTRINGS = [
    "carolineflett",
    "purchased [product name]",
    "date of purchase",
    "forgot your password",
    "spam or promotions folder",
    "used a different email address for making the purchase",
    "made a small typo when entering your email",
    "made a small mistake when entering your email",
    "we’ll get this solved for you",
    "we'll get this solved for you",
    "full name:",
    "email address: (or any other email",
]


def _is_noise(text: str) -> bool:
    low = text.lower()
    if low in ("caroline", "this"):
        return True
    return any(marker in low for marker in NOISE_SUBSTRINGS)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _heading_level(tag: str) -> int | None:
    if tag in ("h1", "h2"):
        return 2
    if tag in ("h3", "h4"):
        return 3
    return None


def digest_page(slug: str, page: dict, seen: set[str]) -> list[str]:
    """Return markdown lines for one page, skipping boilerplate + dupes."""
    lines: list[str] = []
    for item in page.get("texts", []):
        tag = item.get("tag", "p")
        text = _norm(item.get("text", ""))
        if len(text) < MIN_CHARS:
            continue
        key = text.lower()
        if key in BOILERPLATE:
            continue
        if key in seen:
            continue
        if _is_noise(text):
            continue
        seen.add(key)

        level = _heading_level(tag)
        if level is not None:
            lines.append(f"{'#' * level} {text}")
        elif tag == "li":
            lines.append(f"- {text}")
        elif tag in ("button", "a"):
            # Short nav labels add noise; only keep substantive CTAs.
            if len(text.split()) >= 3:
                lines.append(f"> CTA: {text}")
        else:
            lines.append(text)
    return lines


def digest_blog_post(slug: str, page: dict, seen: set[str], max_paragraphs: int = 6) -> list[str]:
    """Condensed summary of a blog post: title + first N substantive paragraphs
    + section headers, so 8 posts don't blow up the in-prompt KB budget."""
    lines: list[str] = []
    title = _norm(page.get("title", slug)).split("|")[0].strip()
    lines.append(f"### Blog: {title}")
    para_count = 0
    for item in page.get("texts", []):
        tag = item.get("tag", "p")
        text = _norm(item.get("text", ""))
        if len(text) < MIN_CHARS:
            continue
        key = text.lower()
        if key in BOILERPLATE or key in seen:
            continue
        if _is_noise(text):
            continue
        if tag in ("h2", "h3") and len(text.split()) <= 12:
            seen.add(key)
            lines.append(f"- Section: {text}")
        elif tag == "p" and para_count < max_paragraphs and len(text.split()) >= 8:
            seen.add(key)
            lines.append(text)
            para_count += 1
    return lines


def extract_contact_email(data: dict) -> str | None:
    contact = data.get("contact", {})
    for item in contact.get("texts", []):
        text = item.get("text", "")
        match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
        if match and "bossclinician" in match.group(0).lower():
            return match.group(0)
    return None


def extract_disclaimer_note(data: dict) -> str | None:
    disclaimer = data.get("disclaimer", {})
    for item in disclaimer.get("texts", []):
        text = _norm(item.get("text", ""))
        if "results may vary" in text.lower() or "cannot guarantee" in text.lower():
            # The scraped disclaimer is a full wall-of-caps legal paragraph;
            # keep only the first two sentences for the in-prompt guardrail.
            sentences = re.split(r"(?<=[.!?])\s+", text)
            return " ".join(sentences[:2])
    return None


def build() -> str:
    data = json.loads(CONTENT_JSON.read_text(encoding="utf-8"))
    seen: set[str] = set()
    out: list[str] = []

    out.append("<!-- AUTO-GENERATED by ai/build_kb.py from shared/content.json. Do not hand-edit; re-run the script instead. -->")
    out.append("# Boss Clinician — Site Knowledge Base\n")
    out.append(
        "Boss Clinician is the coaching brand of **Yvette Howard, LCSW**, a "
        "licensed clinician turned private-practice strategist and group "
        "practice owner (Brighter Tomorrow Therapy). She helps therapists and "
        "other licensed clinicians (LCSW, LPC, LMFT, and similar) who are "
        "burned out on platforms like Alma, Headway, and Talkspace — or "
        "grinding through insurance panels and high caseloads — build "
        "profitable, sustainable private practices they fully own. Core IP: "
        "the **B.O.S.S Blueprint**, a five-pillar framework taught through "
        "1:1 coaching (\"Boss Clinician Consulting\"), courses/templates, a "
        "free masterclass, and group programs.\n"
    )

    email = extract_contact_email(data)
    if email:
        out.append(f"**Contact email:** {email}\n")

    for slug, section_title in PAGE_ORDER:
        page = data.get(slug)
        if not page:
            continue
        body = digest_page(slug, page, seen)
        if not body:
            continue
        out.append(f"## {section_title}\n")
        out.extend(body)
        out.append("")

    blog_slugs = sorted(s for s in data if s.startswith(BLOG_PREFIX))
    if blog_slugs:
        out.append("## Blog Highlights (condensed)\n")
        out.append(
            "Yvette writes practical posts for therapists on pricing, "
            "caseload, marketing, audit-readiness, and mindset. Selected "
            "highlights below; full posts live on the blog.\n"
        )
        for slug in blog_slugs:
            body = digest_blog_post(slug, data[slug], seen)
            out.extend(body)
            out.append("")

    disclaimer = extract_disclaimer_note(data)
    out.append("## Guardrail Facts (always respect)\n")
    out.append(
        "- This is **B2B business coaching for licensed clinicians**, not "
        "clinical treatment, therapy, or medical/mental-health advice. If "
        "someone appears to be a distressed patient/client seeking therapy "
        "for themselves, kindly clarify this is a coaching service for "
        "practitioners and point them to professional mental health "
        "resources (e.g., 988 Suicide & Crisis Lifeline in the US, or their "
        "own provider) instead of engaging clinically."
    )
    out.append(
        "- Results, income figures, and timelines are individual and not "
        "guaranteed — never promise specific income or outcomes."
    )
    if disclaimer:
        out.append(f"- Site disclaimer on record: \"{disclaimer}\"")
    out.append(
        "- Pricing shown in the scraped content may be outdated; when asked "
        "for exact current pricing, share the general range on file but "
        "encourage applying or emailing so Yvette/team can confirm current "
        "offers."
    )
    out.append(
        "- Medicaid/insurance-panel work is not the focus here — the brand "
        "actively helps clinicians shift toward private pay; do not imply "
        "Boss Clinician places or bills insurance on a clinician's behalf."
    )

    return "\n".join(out).strip() + "\n"


def main() -> None:
    markdown = build()
    OUTPUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_MD.write_text(markdown, encoding="utf-8")
    print(f"Wrote {OUTPUT_MD} ({len(markdown):,} chars, ~{len(markdown)//4:,} tokens est.)")


if __name__ == "__main__":
    main()

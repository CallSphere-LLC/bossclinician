#!/usr/bin/env python3
"""
Sheet row R39 (2026-09-29): import the Kajabi podcast "Lyrical Reflections"
into this app, faithfully, and re-host its media.

Source of truth: the show's public RSS feed, discovered from
  https://www.bossclinician.com/podcasts/lyrical-reflections
  <link rel="alternate" type="application/rss+xml" href="https://app.kajabi.com/podcasts/2147779942/feed">
(the public episode pages carry the same title / date / number / notes).

What it does (idempotent; safe to re-run):
  1. Downloads the show artwork, every episode's audio and every episode's
     thumbnail (reusing the show artwork when the thumbnail is identical to it), and stores them exactly the way the admin upload does
     (routes/admin/media.ts): a file in the public uploads volume served at
     /uploads/<16 hex><ext>, plus a media_assets row. File names are derived
     from the Kajabi URL (sha256), so a re-run finds the same files; a file
     already on disk is not downloaded again.
  2. Upserts the podcast (ON CONFLICT slug) and its episodes (matched on
     podcast_id + slug "kajabi-<episode id>").
  3. Unpublishes the test fixture show "the-boss-clinician-show" (no products,
     no feed tokens, one unpublished "ZZ Test" episode). Nothing is deleted.

It writes rows directly with psql: no API call, no domain event, no job — so
nobody is emailed about "new" episodes (there is no new-episode notifier in the
app today either; this just makes sure).

Backup taken before the first run: podcast-before.sql (same directory).

Usage:  python3 podcast-import-kajabi.py [--dry-run] [--offsite]
  --offsite  also copy the new files to s3://bossclinician-media/uploads/
             (the offsite copy of the uploads volume; needs AWS profile bossclinic)
"""
import hashlib
import html
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

FEED_URL = "https://app.kajabi.com/podcasts/2147779942/feed"
SHOW_SLUG = "lyrical-reflections"
FIXTURE_SLUG = "the-boss-clinician-show"
UPLOAD_DIR = "/var/lib/docker/volumes/bossclinician_uploads_data/_data"
UPLOAD_OWNER = "1000:1000"  # matches every other file in the volume
MEDIA_FOLDER = "Podcasts"
DB = ["sudo", "docker", "exec", "-i", "bossclinician-db-1", "psql", "-U", "boss",
      "-d", "bossclinician", "-v", "ON_ERROR_STOP=1", "-X", "-q"]
UA = "Mozilla/5.0 (BossClinician podcast import)"
NS = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
      "content": "http://purl.org/rss/1.0/modules/content/"}

DRY = "--dry-run" in sys.argv
OFFSITE = "--offsite" in sys.argv


# ------------------------------------------------------------------ helpers

def fetch(url: str) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read(), r.headers.get("Content-Type", "")


def q(value) -> str:
    """SQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def psql(sql: str) -> str:
    out = subprocess.run(DB + ["-At"], input=sql.encode(), capture_output=True)
    if out.returncode != 0:
        sys.exit("psql failed:\n" + out.stderr.decode())
    return out.stdout.decode()


class Md(HTMLParser):
    """Kajabi's rich text (p, br, ol/ul/li, a, strong/b, em/i) -> Markdown."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.lists: list[list] = []  # [kind, counter]
        self.href: list[str | None] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "p":
            self.out.append("\n\n")
        elif tag == "br":
            self.out.append("\n")
        elif tag in ("ol", "ul"):
            self.lists.append([tag, 0])
            self.out.append("\n\n")
        elif tag == "li":
            kind = self.lists[-1] if self.lists else ["ul", 0]
            kind[1] += 1
            self.out.append("\n" + ("  " * (len(self.lists) - 1)) +
                            (f"{kind[1]}. " if kind[0] == "ol" else "- "))
        elif tag in ("strong", "b"):
            self.out.append("**")
        elif tag in ("em", "i"):
            self.out.append("*")
        elif tag == "a":
            self.href.append(a.get("href"))
            self.out.append("[")

    def handle_endtag(self, tag):
        if tag == "p":
            self.out.append("\n\n")
        elif tag in ("ol", "ul"):
            if self.lists:
                self.lists.pop()
            self.out.append("\n\n")
        elif tag in ("strong", "b"):
            self.out.append("**")
        elif tag in ("em", "i"):
            self.out.append("*")
        elif tag == "a":
            href = self.href.pop() if self.href else None
            self.out.append(f"]({href})" if href else "]")

    def handle_data(self, data):
        self.out.append(data.replace("\xa0", " "))

    def text(self) -> str:
        raw = "".join(self.out)
        lines = [ln.rstrip() for ln in raw.split("\n")]
        # strip leading spaces except list indentation
        cleaned = []
        for ln in lines:
            s = ln.lstrip(" ")
            indent = ln[: len(ln) - len(s)] if s[:2] in ("- ",) or s[:1].isdigit() else ""
            cleaned.append(indent + s)
        md = "\n".join(cleaned)
        while "\n\n\n" in md:
            md = md.replace("\n\n\n", "\n\n")
        import re
        # Whitespace Kajabi's editor leaves inside link text belongs outside it.
        md = re.sub(r"\[([ \t]+)", r"\1[", md)
        md = re.sub(r"[ \t]+\]\(", "](", md)
        # empty emphasis / empty paragraphs left by <p><br></p>
        return md.replace("****", "").strip()


def html_to_md(src: str) -> str:
    p = Md()
    p.feed(src)
    p.close()
    return p.text()


def html_to_text(src: str) -> str:
    """Plain text summary (the member list shows it line-clamped)."""
    md = html_to_md(src)
    import re
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", md)
    t = t.replace("**", "").replace("\n- ", "\n").strip()
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{2,}", "\n\n", t)


def rehost(url: str, original_name: str, title: str, want: str) -> dict:
    """Ensure url's bytes live in the uploads volume; return file facts."""
    ext = ".mp3" if want == "audio" else ".jpg"
    digest = hashlib.sha256(("kajabi:" + url.split("?")[0]).encode()).hexdigest()[:16]
    filename = digest + ext
    dest = os.path.join(UPLOAD_DIR, filename)
    mime = "audio/mpeg" if want == "audio" else "image/jpeg"

    size = subprocess.run(["sudo", "stat", "-c", "%s", dest], capture_output=True, text=True)
    if size.returncode == 0 and int(size.stdout.strip() or 0) > 0:
        nbytes = int(size.stdout.strip())
        print(f"  have   {filename} ({nbytes} bytes)")
    else:
        body, ctype = fetch(url)
        if want == "audio":
            ok = ctype.startswith("audio/") or body[:3] == b"ID3" or (body[0] == 0xFF and body[1] & 0xE0 == 0xE0)
        else:
            ok = body[:3] == b"\xff\xd8\xff"
        if not ok or len(body) < 1024:
            sys.exit(f"unexpected content from {url}: {ctype} {len(body)} bytes {body[:8]!r}")
        nbytes = len(body)
        if DRY:
            print(f"  (dry) would write {filename} ({nbytes} bytes)")
        else:
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp.write(body)
            subprocess.run(["sudo", "install", "-o", UPLOAD_OWNER.split(":")[0],
                            "-g", UPLOAD_OWNER.split(":")[1], "-m", "644", tmp.name, dest], check=True)
            os.unlink(tmp.name)
            print(f"  stored {filename} ({nbytes} bytes) <- {url}")
        if OFFSITE and not DRY:
            subprocess.run(["sudo", "cp", dest, f"/tmp/{filename}"], check=True)
            subprocess.run(["sudo", "chmod", "644", f"/tmp/{filename}"], check=True)
            subprocess.run(["aws", "s3", "cp", f"/tmp/{filename}",
                            f"s3://bossclinician-media/uploads/{filename}",
                            "--profile", "bossclinic", "--only-show-errors"], check=True)
            subprocess.run(["sudo", "rm", "-f", f"/tmp/{filename}"], check=True)
    return {"filename": filename, "url": f"/uploads/{filename}", "bytes": nbytes,
            "mime": mime, "kind": want if want == "audio" else "image",
            "original_name": original_name, "title": title}


def media_row_sql(f: dict) -> str:
    # Same dedupe rule as the admin upload (assetWithName): one row per original name.
    return f"""
INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title, folder, alt_text)
SELECT {q(f['filename'])}, {q(f['original_name'])}, {q(f['url'])}, {q(f['mime'])}, {q(f['kind'])},
       {f['bytes']}, {q(f['title'])}, {q(MEDIA_FOLDER)}, {q(f['title'] if f['kind'] == 'image' else '')}
WHERE NOT EXISTS (SELECT 1 FROM media_assets WHERE original_name = {q(f['original_name'])});
UPDATE media_assets SET filename = {q(f['filename'])}, url = {q(f['url'])}, size_bytes = {f['bytes']}
 WHERE original_name = {q(f['original_name'])};"""


# --------------------------------------------------------------------- main

def main():
    raw, _ = fetch(FEED_URL)
    ch = ET.fromstring(raw).find("channel")
    title = ch.findtext("title").strip()
    description = html_to_text(ch.findtext("description") or "")
    author = (ch.findtext("itunes:author", namespaces=NS) or "").strip()
    cats = ch.findall("itunes:category", NS)
    category = cats[0].get("text") if cats else "Business"
    explicit = (ch.findtext("itunes:explicit", namespaces=NS) or "false").strip() == "true"
    art_url = ch.find("itunes:image", NS).get("href")
    print(f"show: {title!r} by {author!r}, category {category!r}")

    files = []
    cover = rehost(art_url, f"{SHOW_SLUG}-artwork.jpg", f"{title} — show artwork", "image")
    files.append(cover)
    cover_sha = subprocess.run(["sudo", "sha256sum", os.path.join(UPLOAD_DIR, cover["filename"])],
                               capture_output=True, text=True).stdout.split(" ")[0]

    episodes = []
    for it in ch.findall("item"):
        guid = it.findtext("guid").strip()           # Kajabi-2148691037
        kid = guid.split("-")[-1]
        enc = it.find("enclosure")
        num = it.findtext("itunes:episode", namespaces=NS)
        etype = it.findtext("itunes:episodeType", namespaces=NS)
        body_html = it.findtext("content:encoded", namespaces=NS) or it.findtext("description") or ""
        ep_title = it.findtext("title").strip()
        print(f"episode {kid}: {ep_title!r} ({etype}, #{num})")
        audio = rehost(enc.get("url"), f"{SHOW_SLUG}-{kid}.mp3", ep_title, "audio")
        files.append(audio)
        thumb_el = it.find("itunes:image", NS)
        thumb = None
        if thumb_el is not None and thumb_el.get("href"):
            # Kajabi hands every episode its own thumbnail URL, but for this show
            # they are all byte-for-byte the show artwork: reuse the cover then,
            # rather than filling the media library with nine copies of it.
            thumb_bytes, _ = fetch(thumb_el.get("href"))
            if hashlib.sha256(thumb_bytes).hexdigest() == cover_sha:
                thumb = cover
                print("  artwork: same as the show artwork")
            else:
                thumb = rehost(thumb_el.get("href"), f"{SHOW_SLUG}-{kid}-artwork.jpg", f"{ep_title} — artwork", "image")
                files.append(thumb)
        episodes.append({
            "slug": f"kajabi-{kid}",
            "title": ep_title,
            "description": html_to_text(body_html),
            "show_notes_md": html_to_md(body_html),
            "audio_url": audio["url"],
            "audio_bytes": audio["bytes"],
            "duration": int(float(it.findtext("itunes:duration", namespaces=NS) or 0)),
            "number": int(num) if num else None,
            "published_at": parsedate_to_datetime(it.findtext("pubDate")).isoformat(),
            "cover_image": thumb["url"] if thumb else "",
        })

    sql = ["BEGIN;"]
    sql += [media_row_sql(f) for f in files]
    sql.append(f"""
INSERT INTO podcasts (slug, title, description, cover_image, author, category, language, explicit, visibility, published)
VALUES ({q(SHOW_SLUG)}, {q(title)}, {q(description)}, {q(cover['url'])}, {q(author)}, {q(category)}, 'en', {q(explicit)}, 'public', true)
ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
  cover_image = EXCLUDED.cover_image, author = EXCLUDED.author, category = EXCLUDED.category,
  language = EXCLUDED.language, explicit = EXCLUDED.explicit, visibility = 'public', published = true,
  updated_at = now();""")
    pid = f"(SELECT id FROM podcasts WHERE slug = {q(SHOW_SLUG)})"
    for e in episodes:
        cols = f"""title = {q(e['title'])}, description = {q(e['description'])}, show_notes_md = {q(e['show_notes_md'])},
  audio_url = {q(e['audio_url'])}, audio_bytes = {e['audio_bytes']}, duration_seconds = {e['duration']},
  episode_number = {q(e['number'])}, season = 1, published = true, published_at = {q(e['published_at'])},
  cover_image = {q(e['cover_image'])}"""
        sql.append(f"""
UPDATE podcast_episodes SET {cols}, updated_at = now() WHERE podcast_id = {pid} AND slug = {q(e['slug'])};
INSERT INTO podcast_episodes (podcast_id, slug, title, description, show_notes_md, audio_url, audio_bytes,
  duration_seconds, episode_number, season, published, published_at, cover_image)
SELECT {pid}, {q(e['slug'])}, {q(e['title'])}, {q(e['description'])}, {q(e['show_notes_md'])}, {q(e['audio_url'])},
  {e['audio_bytes']}, {e['duration']}, {q(e['number'])}, 1, true, {q(e['published_at'])}, {q(e['cover_image'])}
WHERE NOT EXISTS (SELECT 1 FROM podcast_episodes WHERE podcast_id = {pid} AND slug = {q(e['slug'])});""")
    # The fixture show: unpublish, never delete.
    sql.append(f"""
UPDATE podcasts SET published = false, updated_at = now()
 WHERE slug = {q(FIXTURE_SLUG)} AND published = true
   AND NOT EXISTS (SELECT 1 FROM products WHERE podcast_id = podcasts.id)
   AND NOT EXISTS (SELECT 1 FROM podcast_feed_tokens WHERE podcast_id = podcasts.id);""")
    sql.append("COMMIT;")
    sql.append(f"""SELECT json_build_object('show', (SELECT row_to_json(p) FROM (SELECT id, slug, title, author, category, cover_image, published FROM podcasts WHERE slug = {q(SHOW_SLUG)}) p),
  'episodes', (SELECT count(*) FROM podcast_episodes WHERE podcast_id = {pid} AND published),
  'fixture_published', (SELECT published FROM podcasts WHERE slug = {q(FIXTURE_SLUG)}));""")
    script = "\n".join(sql)
    if DRY:
        print(script[:4000])
        print(json.dumps(episodes[1], indent=1)[:3000])
        return
    print(psql(script))


if __name__ == "__main__":
    main()

import os, re, json, hashlib, time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

BASE = "https://www.bossclinician.com"
HDR = {"User-Agent": "Mozilla/5.0 (compatible; SiteMigration/1.0)"}

CORE = [
    ("home", "/"),
    ("about_yvette", "/about_yvette"),
    ("about", "/about"),
    ("work-with-me", "/work-with-me"),
    ("all-courses", "/all-courses"),
    ("store", "/store"),
    ("resources", "/resources"),
    ("apply", "/apply"),
    ("contact", "/contact"),
    ("blog", "/blog"),
    ("privacy-policy", "/privacy-policy"),
    ("disclaimer", "/disclaimer"),
    ("financialdisclaimer", "/financialdisclaimer"),
    ("terms-of-use", "/terms-of-use"),
    ("quiz", "/start-your-own-private-practice-quiz"),
]
BLOG = [
    "/blog/why-your-private-practice-marketing-isn-t-working-and-what-to-do-instead",
    "/blog/how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals",
    "/blog/money-guilt-therapists-charging-fees",
    "/blog/dont-let-fear-delay-your-private-practice",
    "/blog/peace-of-mind-for-therapists-audit-preparedness",
    "/blog/what-auditors-look-for-therapist-notes",
    "/blog/clinical-notes-vs-audit-ready-notes",
    "/blog/audit-ready-documentation-private-practice",
]

os.makedirs("pages", exist_ok=True)
os.makedirs("images", exist_ok=True)
img_map = {}

def dl_image(url):
    url = url.split("?")[0]
    if not url or url.startswith("data:"):
        return None
    if url in img_map:
        return img_map[url]
    try:
        r = requests.get(url, headers=HDR, timeout=40)
        if r.status_code != 200 or len(r.content) < 100:
            return None
        ext = os.path.splitext(urlparse(url).path)[1] or ".img"
        ext = ext[:6]
        h = hashlib.md5(url.encode()).hexdigest()[:12]
        name = f"{h}{ext}"
        with open(f"images/{name}", "wb") as f:
            f.write(r.content)
        img_map[url] = name
        return name
    except Exception as e:
        print("  img fail", url, e)
        return None

def scrape(slug, path):
    url = urljoin(BASE, path)
    try:
        r = requests.get(url, headers=HDR, timeout=40)
    except Exception as e:
        print("FAIL", url, e); return
    if r.status_code != 200:
        print("  status", r.status_code, url); return
    soup = BeautifulSoup(r.text, "lxml")
    # save raw html
    with open(f"pages/{slug}.html", "w", encoding="utf-8") as f:
        f.write(r.text)
    # meta
    title = (soup.title.string.strip() if soup.title and soup.title.string else "")
    desc = ""
    md = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    if md:
        desc = md.get("content", "")
    # images
    imgs = []
    for tag in soup.find_all("img"):
        src = tag.get("src") or tag.get("data-src") or ""
        if src:
            src = urljoin(url, src)
            local = dl_image(src)
            if local:
                imgs.append({"orig": src, "local": local, "alt": tag.get("alt", "")})
    # background images in style attrs
    for m in re.finditer(r'url\((?:&quot;|["\']?)(https?://[^"\')]+)', r.text):
        local = dl_image(m.group(1))
        if local:
            imgs.append({"orig": m.group(1), "local": local, "alt": "bg"})
    # visible text blocks
    for s in soup(["script", "style", "noscript"]):
        s.decompose()
    texts = []
    for el in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote", "a", "button"]):
        t = " ".join(el.get_text(" ", strip=True).split())
        if t and len(t) > 1:
            texts.append({"tag": el.name, "text": t})
    data = {"slug": slug, "url": url, "title": title, "description": desc,
            "images": imgs, "texts": texts}
    with open(f"pages/{slug}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"OK {slug}: {len(texts)} blocks, {len(imgs)} imgs")
    time.sleep(0.5)

for slug, path in CORE:
    scrape(slug, path)
for path in BLOG:
    slug = "blog_" + path.split("/")[-1][:40]
    scrape(slug, path)

with open("image_map.json", "w") as f:
    json.dump(img_map, f, indent=2)
print(f"\nTotal unique images: {len(img_map)}")

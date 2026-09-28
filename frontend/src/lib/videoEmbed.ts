/**
 * Turning a video link somebody pasted into something a page can play.
 *
 * Two readers. The course builder stores an embed lesson as an iframe snippet
 * (`embedCodeFor` in pages/admin/CourseBuilder.tsx), and the masterclass page
 * (pages/WatchNow.tsx) plays whatever link the owner set in Settings → Your
 * website → Free masterclass.
 */

/**
 * The share links of the big three refuse to load in a frame (YouTube and Loom
 * send X-Frame-Options), so they are turned into the player address each one
 * publishes for embedding. Anything else is used as pasted.
 */
export function embeddableUrl(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const id = (value: string | null | undefined) => (value && /^[\w-]+$/.test(value) ? value : null);
  if (host === "youtube.com" && url.pathname === "/watch") {
    const v = id(url.searchParams.get("v"));
    if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
  }
  if (host === "youtu.be") {
    const v = id(url.pathname.slice(1));
    if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
  }
  if (host === "youtube.com" && url.pathname.startsWith("/shorts/")) {
    const v = id(url.pathname.split("/")[2]);
    if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
  }
  if (host === "vimeo.com") {
    const [, videoId, hash] = url.pathname.split("/");
    if (/^\d+$/.test(videoId ?? "")) {
      return `https://player.vimeo.com/video/${videoId}${id(hash) ? `?h=${hash}` : ""}`;
    }
  }
  if (host === "loom.com" && url.pathname.startsWith("/share/")) {
    const v = id(url.pathname.split("/")[2]);
    if (v) return `https://www.loom.com/embed/${v}`;
  }
  return link;
}

/**
 * The players the public site may frame. This list and `frame-src` in
 * nginx/site.conf are the same list: a host here that the policy does not name
 * is a blank rectangle on the live site, which is exactly the broken player
 * this module exists to avoid.
 */
export const FRAME_HOSTS: readonly string[] = [
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "www.loom.com",
  "fast.wistia.net",
];

/**
 * Addresses the site itself answers on. A Media Library link is copied with the
 * public origin at the time of copying (lib/siteOrigins.ts), and the site is
 * moving from the callsphere address to bossclinician.com — so a link copied
 * today names a host that will be a different origin tomorrow, and the
 * `media-src 'self'` policy would refuse it. Played by path instead, it is
 * always this origin's own file.
 */
const OWN_HOSTS = new Set([
  "bossclinician.com",
  "www.bossclinician.com",
  "bossclinician.callsphere.site",
]);

/** Formats a `<video>` element plays everywhere it matters. */
const VIDEO_FILE = /\.(mp4|m4v|webm|mov|ogv)$/i;

export type PlayableVideo =
  /** A file this site serves: played in the page's own `<video>`. */
  | { kind: "file"; src: string }
  /** A provider's player, on a host `frame-src` allows. */
  | { kind: "frame"; src: string }
  /** Anything else: offered as a button that opens it, never framed. */
  | { kind: "link"; href: string };

/** A provider link, as the address of its embeddable player on an allowed host. */
function frameSource(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");

  // Already an embed address. YouTube's standard host is moved to the no-cookie
  // one, which is the only YouTube host the policy lists.
  if (host === "youtube.com" && url.pathname.startsWith("/embed/")) {
    return `https://www.youtube-nocookie.com${url.pathname}`;
  }

  // Wistia's share page is `<account>.wistia.com/medias/<id>`; its player is
  // the iframe address below. The id is Wistia's own alphanumeric hash.
  if (/(^|\.)wistia\.(com|net)$/.test(url.hostname) && url.pathname.startsWith("/medias/")) {
    const mediaId = url.pathname.split("/")[2];
    if (mediaId && /^[a-z0-9]+$/i.test(mediaId)) return `https://fast.wistia.net/embed/iframe/${mediaId}`;
  }

  const candidate = new URL(embeddableUrl(url.toString()));
  return candidate.protocol === "https:" && FRAME_HOSTS.includes(candidate.hostname)
    ? candidate.toString()
    : null;
}

/**
 * What to do with the masterclass video link the owner set. Null when there is
 * nothing usable to show, which the page answers with its "coming soon" state.
 *
 * `currentHost` is the host the page is being viewed on, so a link to this very
 * site's uploads is recognised however the owner copied it.
 */
export function playableVideo(raw: string | null | undefined, currentHost?: string): PlayableVideo | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  // A bare path to the site's own uploads (how the Media Library stores it).
  if (value.startsWith("/uploads/")) return { kind: "file", src: value };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // `host`, not `hostname`, against the page's own: `window.location.host`
  // carries the port.
  const ownHost = OWN_HOSTS.has(url.hostname) || (!!currentHost && url.host === currentHost);
  if (ownHost && url.pathname.startsWith("/uploads/")) {
    return { kind: "file", src: `${url.pathname}${url.search}` };
  }

  if (url.protocol === "https:") {
    const frame = frameSource(url);
    if (frame) return { kind: "frame", src: frame };
  }

  // A file on this site outside /uploads/ (the public folder's /videos/, say)
  // still plays; a file on anybody else's host would be refused by
  // `media-src 'self'`, so it becomes a link like everything else.
  if (ownHost && VIDEO_FILE.test(url.pathname)) {
    return { kind: "file", src: `${url.pathname}${url.search}` };
  }

  return { kind: "link", href: url.toString() };
}

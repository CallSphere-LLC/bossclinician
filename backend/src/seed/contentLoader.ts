import fs from "fs";
import path from "path";

export interface ContentImage {
  src: string;
  alt: string;
}

export interface ContentText {
  tag: string;
  text: string;
}

export interface ContentPage {
  slug: string;
  url?: string;
  title: string;
  description: string;
  images: ContentImage[];
  texts: ContentText[];
}

export type ContentMap = Record<string, ContentPage>;

/**
 * Loads the scraped site content used to seed the database.
 * A copy ships inside the backend (src/seed/data/content.json) so seeding
 * works standalone; if the monorepo `shared/content.json` is present and
 * newer, prefer it (lets a re-scrape flow through without a manual copy).
 */
export function loadContent(): ContentMap {
  const bundled = path.join(__dirname, "data", "content.json");
  const sharedCandidates = [
    process.env.SHARED_CONTENT_PATH,
    path.resolve(__dirname, "../../../shared/content.json"),
    path.resolve(process.cwd(), "shared/content.json"),
    path.resolve(process.cwd(), "../shared/content.json"),
  ].filter((p): p is string => Boolean(p));

  let chosen = bundled;
  for (const candidate of sharedCandidates) {
    if (fs.existsSync(candidate)) {
      chosen = candidate;
      break;
    }
  }

  const raw = fs.readFileSync(chosen, "utf-8");
  return JSON.parse(raw) as ContentMap;
}

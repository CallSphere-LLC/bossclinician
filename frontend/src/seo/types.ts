/**
 * The head contract shared by the server render and the browser.
 *
 * One descriptor type, one resolver, two emitters (`renderHead` writes the
 * markup a crawler reads; `applyHead` writes the same information into a live
 * document after a client-side navigation). Keeping both emitters downstream of
 * a single resolved value is what stops the two halves drifting — a page cannot
 * end up with one title in `view-source` and a different one in the tab.
 */

export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | JsonLdValue[]
  | JsonLdNode;

/** One node of schema.org JSON-LD. `@type` is always present in practice. */
export type JsonLdNode = { [key: string]: JsonLdValue | undefined };

export interface HeadDescriptor {
  title: string;
  description?: string;
  /**
   * Site-relative path this page should be indexed under, query string
   * included when it is part of the identity (`/blog?tag=Marketing`). Defaults
   * to the request path with the query dropped.
   */
  canonicalPath?: string;
  /** Site-relative or absolute. Resolved to an absolute URL for og:image. */
  image?: string;
  type?: "website" | "article";
  /** ISO 8601. Article pages only. */
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  /** article:tag values. */
  tags?: string[];
  /** Keeps a page out of the index without keeping it off the site. */
  noindex?: boolean;
  /**
   * The status a server render should answer with, when it is not 200.
   *
   * The page is the only thing that knows: `/blog/<slug>` renders an article or
   * a "not found" panel depending on what came back, and a crawler that gets
   * HTTP 200 on a missing article keeps the dead URL in the index forever.
   */
  httpStatus?: number;
  /** Page-specific structured data. Organization and Person are added sitewide. */
  jsonLd?: JsonLdNode[];
}

export interface HeadMetaTag {
  name?: string;
  property?: string;
  content: string;
}

export interface HeadLinkTag {
  rel: string;
  href: string;
}

export interface ResolvedHead {
  title: string;
  meta: HeadMetaTag[];
  links: HeadLinkTag[];
  jsonLd: JsonLdNode[];
}

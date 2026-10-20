/**
 * Which groups the library's main tab shows, and which tab opens by default.
 *
 * Pure, so the rule that decides whether a purchase is visible can be tested
 * without rendering the page.
 */

export type LibraryTab = "courses" | "documents";

/** Download products: the Documents tab lists their files one by one. */
export const DOCUMENT_KIND = "download";

interface ShelfGroup {
  kind: string;
}

/**
 * Everything owned is a card on the main tab — downloads included.
 *
 * The Documents tab is a flat list of files, not the only place a download
 * product appears. Keeping download products off the main tab meant that a
 * customer who owned anything else (a membership, a course) landed on a shelf
 * without the toolkit she had just bought, and had to know to click
 * "Documents" to find it.
 */
export function shelfGroups<G extends ShelfGroup>(groups: readonly G[]): G[] {
  return [...groups];
}

/**
 * The tab to show. An explicit, valid `?tab=` wins. Otherwise somebody who owns
 * only documents lands on the file list; everybody else on the shelf.
 */
export function defaultLibraryTab(
  requestedTab: string | null,
  groups: readonly ShelfGroup[] | null,
): LibraryTab {
  if (requestedTab === "documents" || requestedTab === "courses") return requestedTab;
  if (groups === null) return "courses";
  const ownsDocuments = groups.some((group) => group.kind === DOCUMENT_KIND);
  const ownsOther = groups.some((group) => group.kind !== DOCUMENT_KIND);
  return ownsDocuments && !ownsOther ? "documents" : "courses";
}

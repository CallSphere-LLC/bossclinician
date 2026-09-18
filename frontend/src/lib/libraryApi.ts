import { memberFetch, memberRequest, type RequestOptions } from "@/lib/memberApi";

/**
 * Library domain client — the shelf, the player, and everything a member
 * writes while working through a course.
 *
 * Built on `memberRequest` rather than added to memberApi.ts, so it shares the
 * one access token and the one refresh path without that file growing a second
 * domain. Nothing here touches storage or auth.
 *
 * The types below mirror `routes/member/library.ts` and `routes/member/progress.ts`
 * field for field. Two of them are deliberately unions rather than one wide
 * optional-everything shape:
 *
 *  - `PlayerLesson` splits on `locked`, because a locked lesson genuinely has no
 *    body — the server does not select the content columns at all. Modelling it
 *    as "the same lesson with empty strings" would let a component reach for
 *    `lesson.videoUrl` on a locked lesson and get `""` instead of a type error,
 *    which is exactly the mistake the drip schedule exists to prevent.
 *  - `LibraryProduct` splits on `kind`, because a download product has files and
 *    a course has modules, and neither has the other's fields.
 */

export type LessonContentType = "video" | "audio" | "text" | "pdf" | "embed" | "assessment";

/** Mirrors `CourseRollup` on the server. `percent` is floored, so 100 means finished. */
export interface CourseProgress {
  lessonsTotal: number;
  lessonsCompleted: number;
  percent: number;
  completedAt: string | null;
}

/* --------------------------------------------------------------- the shelf */

/**
 * Where "pick up where you left off" points.
 *
 * `href` arrives from the server already built; it is used verbatim rather than
 * reconstructed here so the two cannot drift apart.
 */
export interface ContinueLesson {
  lessonId: number;
  lessonSlug: string;
  title: string;
  moduleTitle: string;
  contentType: LessonContentType;
  lastPositionSeconds: number;
  watchedPercent: number;
  lastViewedAt: string | null;
  href: string;
}

export interface LibraryItem {
  productId: number;
  slug: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  kind: string;
  kindLabel: string;
  courseId: number | null;
  grantedAt: string;
  expiresAt: string | null;
  /** Whole days, floored. null when access never lapses. */
  expiresInDays: number | null;
  expiringSoon: boolean;
  /** null for anything that is not a course — a PDF has no lessons to count. */
  progress: Pick<CourseProgress, "lessonsTotal" | "lessonsCompleted" | "percent"> | null;
  started: boolean;
  completed: boolean;
  continueLesson: ContinueLesson | null;
  href: string;
}

export interface LibraryGroup {
  kind: string;
  label: string;
  items: LibraryItem[];
}

export interface LibraryResponse {
  items: LibraryItem[];
  groups: LibraryGroup[];
  total: number;
  expiringSoonCount: number;
  continueLesson: ContinueLesson | null;
}

/* ------------------------------------------------------------ one product */

export interface OutlineLesson {
  id: number;
  slug: string;
  title: string;
  contentType: LessonContentType;
  durationMinutes: number;
  videoDurationSeconds: number;
  preview: boolean;
  unlocked: boolean;
  unlocksAt: string | null;
  /** "Unlocks Thursday, 22 January", or "" once it is open. */
  unlockLabel: string;
  completed: boolean;
  completedAt: string | null;
  lastPositionSeconds: number;
  watchedPercent: number;
  href: string;
}

export interface OutlineModule {
  id: number;
  title: string;
  summary: string;
  unlocked: boolean;
  unlocksAt: string | null;
  unlockLabel: string;
  lessons: OutlineLesson[];
}

export interface CourseOutlineData {
  courseId: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  grantedAt: string;
  /** The zone every unlock label above is quoted in. */
  timezone: string;
  progress: CourseProgress;
  continueLesson: ContinueLesson | null;
  modules: OutlineModule[];
}

export interface ProductFile {
  id: number;
  title: string;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface BundleEntry {
  slug: string;
  title: string;
  subtitle: string;
  kind: string;
  kindLabel: string;
  thumbnailUrl: string;
  href: string;
}

interface ProductBase {
  productId: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnailUrl: string;
  kindLabel: string;
}

export type LibraryProduct =
  | (ProductBase & { kind: "course"; course: CourseOutlineData })
  | (ProductBase & { kind: "download"; instructions?: string; files: ProductFile[] })
  | (ProductBase & { kind: "bundle"; contents: BundleEntry[] })
  | (ProductBase & {
      kind: "community" | "coaching" | "podcast" | "newsletter" | "access_group";
      communityId: number | null;
      podcastId: number | null;
      newsletterId: number | null;
      coachingOfferId: number | null;
    });

/* ------------------------------------------------------------- one lesson */

export interface LessonFile {
  id: number;
  title: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface LessonProgress {
  completed: boolean;
  completedAt: string | null;
  lastPositionSeconds: number;
  watchedPercent: number;
}

interface LessonCommon {
  id: number;
  slug: string;
  title: string;
  moduleId: number;
  moduleTitle: string;
}

export interface LockedLesson extends LessonCommon {
  locked: true;
  unlocksAt: string | null;
  unlockLabel: string;
}

export interface UnlockedLesson extends LessonCommon {
  locked: false;
  contentType: LessonContentType;
  unlocksAt: null;
  unlockLabel: string;
  durationMinutes: number;
  videoDurationSeconds: number;
  preview: boolean;
  bodyMd: string;
  videoUrl: string;
  audioUrl: string;
  /** Author-written markup. Rendered inside a sandboxed frame, never inlined. */
  embedHtml: string;
  transcript: string;
  captionsUrl: string;
  attachmentUrl: string;
  /** Linked graded test; null while the test is still a draft or none is attached. */
  assessmentSlug: string | null;
  /**
   * When the four media URLs above stop working, or null if none needed signing.
   *
   * A lesson's own video, audio, captions and PDF live in the protected upload
   * directory, which nothing serves by path: the server hands them over as
   * signed links bound to this member and dead two hours after they were minted.
   * That is longer than any lesson, but not longer than a lesson left paused
   * over lunch, and when it passes the media element's next range request comes
   * back 404 — the video stops mid-sentence with no way back but a reload.
   *
   * So the expiry is part of the contract rather than an implementation detail
   * the client is left to discover: the player reloads this response shortly
   * before the moment named here and swaps in fresh URLs. An unsigned lesson —
   * a Vimeo embed, a public /uploads path — has nothing to expire and sends null.
   */
  mediaExpiresAt: string | null;
  commentsEnabled: boolean;
  notesEnabled: boolean;
  files: LessonFile[];
  progress: LessonProgress;
}

export type PlayerLesson = LockedLesson | UnlockedLesson;

export interface LessonNeighbour {
  slug: string;
  title: string;
  /** So "next" can be greyed out rather than opening onto an unlock date. */
  unlocked: boolean;
}

export interface LessonResponse {
  product: { slug: string; title: string };
  course: {
    courseId: number;
    slug: string;
    title: string;
    timezone: string;
    progress: CourseProgress;
  };
  prev: LessonNeighbour | null;
  next: LessonNeighbour | null;
  lesson: PlayerLesson;
}

/* ---------------------------------------------------- progress, notes, talk */

export interface ProgressResult {
  lessonId: number;
  lastPositionSeconds: number;
  watchedPercent: number;
  completed: boolean;
  completedAt: string | null;
  courseProgress: CourseProgress;
}

export interface LessonNote {
  lessonId: number;
  notesEnabled: boolean;
  body: string;
  updatedAt: string | null;
}

export interface LessonComment {
  id: number;
  parentId: number | null;
  memberId: number | null;
  authorName: string;
  authorAvatarUrl: string;
  /** The coach's own replies — the ones people scroll looking for. */
  authorIsHost: boolean;
  body: string;
  pending: boolean;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
  replies: LessonComment[];
}

export interface LessonCommentsResponse {
  lessonId: number;
  commentsEnabled: boolean;
  comments: LessonComment[];
}

/**
 * A minted download credential. Short-lived and single-member, so it is
 * requested at the moment of the click and never held in state.
 */
export interface DownloadLink {
  url: string;
  filename: string;
  title: string;
  sizeBytes: number;
  expiresAt: string;
  expiresInSeconds: number;
}

export type DownloadKind = "product" | "lesson";

/**
 * One row of "all my downloads". Mirrors `DownloadItem` in
 * `routes/member/downloads.ts`.
 *
 * A lesson attachment that has not dripped yet is still listed, with
 * `available: false`, an unlock label, and no filename or size — the server
 * withholds both until the lesson opens.
 */
export interface DownloadListItem {
  kind: DownloadKind;
  id: number;
  title: string;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sizeLabel: string;
  available: boolean;
  unlocksAt: string | null;
  unlockLabel: string | null;
  /** A display hint. The credential is minted by `downloadLink`, as everywhere else. */
  linkUrl: string | null;
  productId: number | null;
  productTitle: string;
  productSlug: string;
  courseId: number | null;
  courseTitle: string;
  lessonId: number | null;
  lessonTitle: string;
  moduleTitle: string;
  downloadCount: number;
  createdAt: string;
}

export interface DownloadsResponse {
  files: DownloadListItem[];
  total: number;
  availableCount: number;
  linkTtlSeconds: number;
}

/* ------------------------------------------------------------ certificates */

/**
 * Mirrors `CertificateJson` in `routes/member/certificates.ts`.
 *
 * A withdrawn certificate stays in the list with `revoked: true`, and the
 * server blanks its code and both of its URLs — so those three are empty
 * strings, not missing, and must be checked before they are shown or followed.
 */
export interface MemberCertificate {
  id: number;
  courseId: number | null;
  courseSlug: string | null;
  courseTitle: string;
  recipientName: string;
  verificationCode: string;
  /** A site path — `/verify/<code>` — that a licensing board can open signed out. */
  verifyUrl: string;
  downloadUrl: string;
  creditQuarterHours: number;
  /** "1.5 CE hours", or "" for a course that carries no CE credit. */
  creditHours: string;
  providerNumber: string;
  completedAt: string;
  issuedAt: string;
  revoked: boolean;
  revokedAt: string | null;
}

export interface CertificateClaimResult {
  /** null when there is nothing to issue yet — `message` says why, in the server's words. */
  certificate: MemberCertificate | null;
  message: string;
}

/* -------------------------------------------------------------------- paths */

/**
 * The player's own URLs, in one place.
 *
 * The server builds the same strings into every `href` it returns, and the two
 * have to agree: a card linking somewhere the router does not resolve is a dead
 * end that only shows up once real data exists.
 */
export function productPath(productSlug: string): string {
  return `/library/${encodeURIComponent(productSlug)}`;
}

export function lessonPath(productSlug: string, lessonSlug: string): string {
  return `/library/${encodeURIComponent(productSlug)}/lessons/${encodeURIComponent(lessonSlug)}`;
}

const api = (path: string): string => `/member/library${path}`;

/* ------------------------------------------------------------------ client */

export const libraryApi = {
  getLibrary: () => memberRequest<LibraryResponse>(api("/")),

  getProduct: (productSlug: string) =>
    memberRequest<LibraryProduct>(api(`/${encodeURIComponent(productSlug)}`)),

  getLesson: (productSlug: string, lessonSlug: string) =>
    memberRequest<LessonResponse>(
      api(`/${encodeURIComponent(productSlug)}/lessons/${encodeURIComponent(lessonSlug)}`),
    ),

  /**
   * A position ping. `keepalive` is set by the player's final write, so the
   * request survives the page being closed mid-lesson — without it, the last
   * ten seconds before someone shuts the tab are simply lost, which is the one
   * moment resume-at-timestamp most needs to be right.
   */
  saveProgress: (
    lessonId: number,
    input: { positionSeconds: number; watchedPercent: number },
    options: Pick<RequestOptions, "keepalive"> = {},
  ) =>
    memberRequest<ProgressResult>(`/member/lessons/${lessonId}/progress`, {
      method: "POST",
      body: JSON.stringify(input),
      ...options,
    }),

  toggleComplete: (lessonId: number, done: boolean) =>
    memberRequest<ProgressResult>(`/member/lessons/${lessonId}/complete`, {
      method: done ? "POST" : "DELETE",
    }),

  getNote: (lessonId: number) => memberRequest<LessonNote>(`/member/lessons/${lessonId}/notes`),

  saveNote: (lessonId: number, body: string) =>
    memberRequest<LessonNote>(`/member/lessons/${lessonId}/notes`, {
      method: "PUT",
      body: JSON.stringify({ body }),
    }),

  getComments: (lessonId: number) =>
    memberRequest<LessonCommentsResponse>(`/member/lessons/${lessonId}/comments`),

  postComment: (lessonId: number, input: { body: string; parentId?: number | null }) =>
    memberRequest<LessonComment>(`/member/lessons/${lessonId}/comments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  editComment: (commentId: number, body: string) =>
    memberRequest<LessonComment>(`/member/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),

  deleteComment: (commentId: number) =>
    memberRequest<{ id: number; deleted: boolean }>(`/member/comments/${commentId}`, {
      method: "DELETE",
    }),

  /**
   * Mints a signed link for one file.
   *
   * The path is built from (kind, id) rather than taken from the `downloadUrl`
   * the listing carries, because that field is a display hint and this is the
   * endpoint that actually issues the credential.
   */
  downloadLink: (kind: DownloadKind, fileId: number) =>
    memberRequest<DownloadLink>(`/member/downloads/${kind}/${fileId}/link`, { method: "POST" }),

  /** Every file the member can reach, across every product and course they own. */
  getDownloads: () => memberRequest<DownloadsResponse>("/member/downloads"),

  getCertificates: () =>
    memberRequest<{ certificates: MemberCertificate[] }>("/member/certificates"),

  /**
   * Asks for the certificate of a finished course. Idempotent: one that already
   * exists comes back unchanged, with no second email.
   */
  claimCertificate: (courseId: number) =>
    memberRequest<CertificateClaimResult>("/member/certificates/claim", {
      method: "POST",
      body: JSON.stringify({ courseId }),
    }),
};

/** Where a certificate's PDF is fetched from. Needs the Bearer token, so not an href. */
export function certificateDownloadPath(certificateId: number): string {
  return `/member/certificates/${certificateId}/download`;
}

/** The name the server gave the file, or a sensible one if the header is unreadable. */
function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // Falls through to the plain form.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

/**
 * Fetches a certificate's PDF and hands it to the browser.
 *
 * Unlike the files above there is no signed link to mint: the route answers with
 * the bytes themselves, behind the Bearer token. So the PDF is read as a blob and
 * saved through an object URL, which is released straight after the click.
 */
export async function downloadCertificate(certificate: MemberCertificate): Promise<void> {
  const res = await memberFetch(certificateDownloadPath(certificate.id));
  const blob = await res.blob();

  const filename = filenameFromDisposition(
    res.headers.get("Content-Disposition"),
    `certificate-${certificate.verificationCode || certificate.id}.pdf`,
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred a tick: some browsers start reading the blob after `click` returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Mints a link and hands the file to the browser.
 *
 * A synthetic anchor rather than `location.assign`, because the endpoint answers
 * with `Content-Disposition: attachment` and navigating would tear down the
 * player — including the progress write that has not gone out yet — to fetch
 * something that was never going to render as a page.
 */
export async function downloadFile(kind: DownloadKind, fileId: number): Promise<DownloadLink> {
  const link = await libraryApi.downloadLink(kind, fileId);

  const anchor = document.createElement("a");
  anchor.href = link.url;
  anchor.download = link.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  return link;
}

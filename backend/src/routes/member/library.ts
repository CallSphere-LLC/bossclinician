import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound, unauthorized } from "../../utils/httpError";
import type { AuthedMember } from "../../middleware/memberAuth";
import { hasProductAccess, listMemberProducts } from "../../services/access";
import {
  flattenLessons,
  loadCourseForMember,
  summariseCoursesForMember,
  type MemberCourseView,
  type MemberLessonView,
} from "../../services/curriculum";
import { isProtectedRef, signedFileUrl } from "../../services/signedUrls";
import { downloadLinkPath, type LessonMediaKind } from "./downloads";

/**
 * `/api/member/library` — everything the customer has paid for, and the player
 * that plays it.
 *
 * `requireMember` is applied once by routes/member/index.ts, which answers "who
 * are you". Every handler below then asks access.ts "and what do you own",
 * because those are different questions and only the second one decides whether
 * a lesson body is written to a response. Nothing here infers entitlement from
 * an order, an enrollment or a subscription.
 *
 * A product or lesson the member does not own is answered with 404, never 403.
 * Product slugs are guessable from the marketing site, and a 403 would confirm
 * which of them exist and that they are worth trying again later.
 */
export const memberLibraryRouter = Router();

const TOO_MANY = { error: "Too many requests. Please try again later." };

/** Keyed on the member, not the IP: a clinic behind one address is many people. */
const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/**
 * A lesson response carries the transcript and the video URL, so the abuse case
 * is a script walking a whole course rather than a person reading one page.
 * Well above any real reading pace, well below a scrape.
 */
const lessonReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

/** requireMember has already run; this keeps the guarantee in the type system too. */
function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

/**
 * Slugs, as tightly as the ones we generate.
 *
 * Anything else is answered as a missing product rather than as a validation
 * error: a malformed slug and an unknown one are the same event to the person
 * who typed the URL, and telling them apart tells a prober which is which.
 */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const productParamsSchema = z.object({ productSlug: slugSchema });
const lessonParamsSchema = z.object({ productSlug: slugSchema, lessonSlug: slugSchema });

const PRODUCT_MISSING = "We couldn't find that in your library.";
const LESSON_MISSING = "We couldn't find that lesson.";

/**
 * A URL the player can use directly, for whatever a lesson's media column holds.
 *
 * Three cases, and only the first of them is ours. A protected reference names a
 * file in the directory nothing serves, so it is signed here into a link bound to
 * this member and dead in two hours. An /uploads path is a file the owner
 * uploaded as public and is already a working URL. An absolute link belongs to
 * somebody else — a Vimeo embed, a caption file on a CDN — and is passed through
 * untouched.
 *
 * The result goes straight into a <video src>, which is why it is a URL and not
 * an endpoint to POST to: an element cannot send an Authorization header, so the
 * credential has to be in the address.
 */
function playableUrl(input: {
  reference: string;
  kind: LessonMediaKind;
  lessonId: number;
  memberId: number;
  now: Date;
}): { url: string; expiresAt: Date | null } {
  if (!isProtectedRef(input.reference)) return { url: input.reference, expiresAt: null };
  return signedFileUrl({
    kind: input.kind,
    fileId: input.lessonId,
    memberId: input.memberId,
    now: input.now,
  });
}

/* ------------------------------------------------------------------- library */

/** How close an expiry has to be before the library says anything about it. */
const EXPIRING_SOON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_LABELS: Record<string, string> = {
  course: "Courses",
  community: "Communities",
  coaching: "Coaching",
  download: "Downloads",
  podcast: "Podcasts",
  newsletter: "Newsletters",
  access_group: "Memberships",
  bundle: "Bundles",
};

/** Courses first: it is what most people came back for. */
const KIND_ORDER = [
  "course",
  "community",
  "coaching",
  "download",
  "podcast",
  "newsletter",
  "access_group",
  "bundle",
];

interface ContinueLessonJson {
  lessonId: number;
  lessonSlug: string;
  title: string;
  moduleTitle: string;
  contentType: string;
  lastPositionSeconds: number;
  watchedPercent: number;
  lastViewedAt: string | null;
  href: string;
}

function toContinueJson(productSlug: string, lesson: MemberLessonView): ContinueLessonJson {
  return {
    lessonId: lesson.id,
    lessonSlug: lesson.slug,
    title: lesson.title,
    moduleTitle: lesson.moduleTitle,
    contentType: lesson.contentType,
    lastPositionSeconds: lesson.lastPositionSeconds,
    watchedPercent: lesson.watchedPercent,
    lastViewedAt: lesson.lastViewedAt,
    href: `/library/${productSlug}/lessons/${lesson.slug}`,
  };
}

interface LibraryItem {
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
  expiresInDays: number | null;
  expiringSoon: boolean;
  progress: { lessonsTotal: number; lessonsCompleted: number; percent: number } | null;
  started: boolean;
  completed: boolean;
  continueLesson: ContinueLessonJson | null;
  href: string;
}

/**
 * Whole days until access lapses, rounded down, floored at zero.
 *
 * Rounded down so "expires in 1 day" never appears on something that lapses in
 * twenty-five hours, and floored because a grant already past its date is
 * filtered out upstream — a negative countdown here would mean a clock skew,
 * not a real number to show anybody.
 */
function daysUntil(expiresAt: string | null, now: Date): number | null {
  if (expiresAt === null) return null;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.floor((parsed.getTime() - now.getTime()) / DAY_MS));
}

/**
 * GET /api/member/library
 *
 * The shelf. Two queries beyond the grant list itself, no matter how much is
 * owned: one outline covering every course at once, and the grant times behind
 * it. Progress is derived from the lessons rather than read from
 * `course_progress`, so a course that gained a lesson this morning shows the
 * right denominator before the member has touched anything.
 */
memberLibraryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const now = new Date();

    const owned = await listMemberProducts(member.id);

    // `courseId` is only meaningful on a product of kind 'course'. The constraint
    // on `products` does not stop a download product carrying a stray course_id,
    // and summarising against one would put a progress ring on a PDF.
    const courseIds = [
      ...new Set(
        owned.flatMap((p) => (p.kind === "course" && p.courseId !== null ? [p.courseId] : []))
      ),
    ];

    const summaries = await summariseCoursesForMember(member.id, courseIds, now);

    const items: LibraryItem[] = owned.map((product) => {
      const summary =
        product.kind === "course" && product.courseId !== null
          ? summaries.get(product.courseId)
          : undefined;
      const expiresInDays = daysUntil(product.expiresAt, now);

      return {
        productId: product.productId,
        slug: product.slug,
        title: product.title,
        subtitle: product.subtitle,
        thumbnailUrl: product.thumbnailUrl,
        kind: product.kind,
        kindLabel: KIND_LABELS[product.kind] ?? "Other",
        courseId: product.courseId,
        grantedAt: product.grantedAt,
        expiresAt: product.expiresAt,
        expiresInDays,
        expiringSoon: expiresInDays !== null && expiresInDays <= EXPIRING_SOON_DAYS,
        progress: summary
          ? {
              lessonsTotal: summary.progress.lessonsTotal,
              lessonsCompleted: summary.progress.lessonsCompleted,
              percent: summary.progress.percent,
            }
          : null,
        started: summary ? summary.progress.lessonsCompleted > 0 : false,
        completed: summary ? summary.progress.completedAt !== null : false,
        continueLesson: summary?.continueLesson
          ? toContinueJson(product.slug, summary.continueLesson)
          : null,
        href: `/library/${product.slug}`,
      };
    });

    // Anything owned whose kind KIND_ORDER has not heard of lands in a group at
    // the end rather than vanishing from the page — a shelf that quietly omits
    // something the customer paid for is the one failure here nobody would spot.
    const kinds = [...new Set([...KIND_ORDER, ...items.map((item) => item.kind)])];
    const groups = kinds
      .map((kind) => ({
        kind,
        label: KIND_LABELS[kind] ?? "Other",
        items: items.filter((item) => item.kind === kind),
      }))
      .filter((group) => group.items.length > 0);

    res.json({
      items,
      groups,
      total: items.length,
      expiringSoonCount: items.filter((item) => item.expiringSoon).length,
      // One "pick up where you left off" for the top of the page: whichever
      // course was touched most recently, falling back to the newest purchase
      // for somebody who has not started anything yet.
      continueLesson: pickLibraryContinue(items),
    });
  })
);

function pickLibraryContinue(items: LibraryItem[]): ContinueLessonJson | null {
  const candidates = items.filter(
    (item): item is LibraryItem & { continueLesson: ContinueLessonJson } =>
      item.continueLesson !== null
  );
  if (candidates.length === 0) return null;

  const touched = candidates
    .filter((item) => item.continueLesson.lastViewedAt !== null)
    .sort((a, b) =>
      (b.continueLesson.lastViewedAt ?? "").localeCompare(a.continueLesson.lastViewedAt ?? "")
    );

  // `owned` arrives newest grant first, so the first untouched candidate is the
  // most recent purchase.
  return (touched[0] ?? candidates[0]).continueLesson;
}

/* --------------------------------------------------------------- one product */

interface ProductRow {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  thumbnail_url: string;
  kind: string;
  course_id: number | null;
  community_id: number | null;
  podcast_id: number | null;
  newsletter_id: number | null;
  coaching_offer_id: number | null;
}

/**
 * Loads a product the member holds a live grant for, or throws 404.
 *
 * The slug is resolved first and the entitlement asked second, so the only
 * source of the answer is access.ts. An archived product is excluded to match
 * what /library lists — a shelf and its shelves' pages disagreeing about what
 * is on them is its own kind of bug.
 */
async function loadOwnedProduct(memberId: number, slug: string): Promise<ProductRow> {
  const found = await pool.query<ProductRow>(
    `SELECT id, slug, title, subtitle, description, thumbnail_url, kind, course_id,
            community_id, podcast_id, newsletter_id, coaching_offer_id
       FROM products
      WHERE slug = $1 AND status <> 'archived'`,
    [slug]
  );
  const product = found.rows[0];
  if (!product) throw notFound(PRODUCT_MISSING);

  if (!(await hasProductAccess(memberId, product.id))) throw notFound(PRODUCT_MISSING);
  return product;
}

function readProductSlug(req: Request): string {
  const parsed = productParamsSchema.safeParse(req.params);
  if (!parsed.success) throw notFound(PRODUCT_MISSING);
  return parsed.data.productSlug;
}

interface ProductFileJson {
  id: number;
  title: string;
  description: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  downloadUrl: string;
}

/**
 * Files a `download` product delivers.
 *
 * `storage_path` is never selected: it is a location on our disk, and the only
 * way bytes leave is a signed URL minted per request by the downloads route.
 */
async function loadProductFiles(productId: number): Promise<ProductFileJson[]> {
  const files = await pool.query<{
    id: number;
    title: string;
    description: string;
    filename: string;
    mime: string;
    size_bytes: string | number;
  }>(
    `SELECT id, title, description, filename, mime, size_bytes
       FROM product_files WHERE product_id = $1 ORDER BY sort, id`,
    [productId]
  );

  return files.rows.map((f) => ({
    id: f.id,
    title: f.title || f.filename,
    description: f.description,
    filename: f.filename,
    mime: f.mime,
    // BIGINT arrives from pg as a string.
    sizeBytes: Number(f.size_bytes) || 0,
    downloadUrl: downloadLinkPath("product", f.id),
  }));
}

/**
 * What a bundle actually got them.
 *
 * Filtered to grants the member holds rather than to the bundle's contents:
 * purchasing a bundle grants each product inside it separately, and if one of
 * those grants was later revoked the bundle page must not still advertise it.
 */
async function loadBundleContents(memberId: number, bundleProductId: number) {
  const res = await pool.query<{
    slug: string;
    title: string;
    subtitle: string;
    kind: string;
    thumbnail_url: string;
  }>(
    `SELECT p.slug, p.title, p.subtitle, p.kind, p.thumbnail_url
       FROM product_bundle_items bi
       JOIN products p ON p.id = bi.product_id
       JOIN access_grants g ON g.product_id = p.id AND g.member_id = $1
      WHERE bi.bundle_product_id = $2 AND p.status <> 'archived'
        AND g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now())
      ORDER BY bi.sort, p.id`,
    [memberId, bundleProductId]
  );

  return res.rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    kind: r.kind,
    kindLabel: KIND_LABELS[r.kind] ?? "Other",
    thumbnailUrl: r.thumbnail_url,
    href: `/library/${r.slug}`,
  }));
}

function toOutlineJson(course: MemberCourseView, productSlug: string) {
  return {
    courseId: course.courseId,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    image: course.image,
    grantedAt: course.grantedAt,
    timezone: course.timezone,
    progress: course.progress,
    continueLesson: course.continueLesson
      ? toContinueJson(productSlug, course.continueLesson)
      : null,
    modules: course.modules.map((mod) => ({
      id: mod.id,
      title: mod.title,
      summary: mod.summary,
      unlocked: mod.unlocked,
      unlocksAt: mod.unlocksAt,
      unlockLabel: mod.unlockLabel,
      lessons: mod.lessons.map((lesson) => ({
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        contentType: lesson.contentType,
        durationMinutes: lesson.durationMinutes,
        videoDurationSeconds: lesson.videoDurationSeconds,
        preview: lesson.preview,
        unlocked: lesson.unlocked,
        unlocksAt: lesson.unlocksAt,
        unlockLabel: lesson.unlockLabel,
        completed: lesson.completed,
        completedAt: lesson.completedAt,
        lastPositionSeconds: lesson.lastPositionSeconds,
        watchedPercent: lesson.watchedPercent,
        href: `/library/${productSlug}/lessons/${lesson.slug}`,
      })),
    })),
  };
}

/**
 * GET /api/member/library/:productSlug
 *
 * The product, plus whatever kind of thing it is. For a course that means the
 * full outline with each lesson's drip state and the member's progress on it —
 * titles and dates only. Not one lesson body is selected here, however many of
 * them are unlocked, because this response is a table of contents.
 */
memberLibraryRouter.get(
  "/:productSlug",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const slug = readProductSlug(req);
    const product = await loadOwnedProduct(member.id, slug);

    const base = {
      productId: product.id,
      slug: product.slug,
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      thumbnailUrl: product.thumbnail_url,
      kind: product.kind,
      kindLabel: KIND_LABELS[product.kind] ?? "Other",
    };

    if (product.kind === "course" && product.course_id !== null) {
      const course = await loadCourseForMember(member.id, product.course_id);
      // The grant is on the product and the course is what it points at, so a
      // null here is a product configured against a course that has since been
      // deleted — nothing the member can be shown.
      if (!course) throw notFound(PRODUCT_MISSING);
      res.json({ ...base, course: toOutlineJson(course, product.slug) });
      return;
    }

    if (product.kind === "download") {
      res.json({ ...base, files: await loadProductFiles(product.id) });
      return;
    }

    if (product.kind === "bundle") {
      res.json({ ...base, contents: await loadBundleContents(member.id, product.id) });
      return;
    }

    // community / coaching / podcast / newsletter / access_group: the ids the
    // surface that owns each of them needs to load itself.
    res.json({
      ...base,
      communityId: product.community_id,
      podcastId: product.podcast_id,
      newsletterId: product.newsletter_id,
      coachingOfferId: product.coaching_offer_id,
    });
  })
);

/* ---------------------------------------------------------------- one lesson */

interface LessonContentRow {
  body_md: string;
  video_url: string;
  audio_url: string;
  embed_html: string;
  transcript: string;
  captions_url: string;
  attachment_url: string;
}

function neighbour(lesson: MemberLessonView | undefined) {
  if (!lesson) return null;
  return {
    slug: lesson.slug,
    title: lesson.title,
    // So the player can grey out "next" rather than offering a door that opens
    // onto an unlock date.
    unlocked: lesson.unlocked,
  };
}

/**
 * GET /api/member/library/:productSlug/lessons/:lessonSlug
 *
 * The player's one read. Resolution goes through the member's own outline, which
 * means the lesson is proved to sit inside the course this product grants before
 * anything is read from it — a lesson slug cannot be used to reach across into a
 * course they merely happen to own something else in.
 *
 * A locked lesson returns its title and its unlock date. The content columns are
 * not selected at all in that case, rather than selected and then omitted:
 * shipping the body and hiding it in the client is how a drip schedule becomes a
 * suggestion.
 */
memberLibraryRouter.get(
  "/:productSlug/lessons/:lessonSlug",
  lessonReadLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = lessonParamsSchema.safeParse(req.params);
    if (!parsed.success) throw notFound(LESSON_MISSING);
    const { productSlug, lessonSlug } = parsed.data;

    const product = await loadOwnedProduct(member.id, productSlug);
    if (product.kind !== "course" || product.course_id === null) throw notFound(LESSON_MISSING);

    const course = await loadCourseForMember(member.id, product.course_id);
    if (!course) throw notFound(LESSON_MISSING);

    const lessons = flattenLessons(course.modules);
    // Slugs are unique per module rather than per course, so a course could hold
    // two lessons called "welcome" in different modules. Curriculum order
    // decides, which is the one the navigation reaches first.
    const index = lessons.findIndex((l) => l.slug === lessonSlug);
    if (index < 0) throw notFound(LESSON_MISSING);
    const lesson = lessons[index];

    const shared = {
      product: { slug: product.slug, title: product.title },
      course: {
        courseId: course.courseId,
        slug: course.slug,
        title: course.title,
        timezone: course.timezone,
        progress: course.progress,
      },
      prev: neighbour(lessons[index - 1]),
      next: neighbour(lessons[index + 1]),
    };

    if (!lesson.unlocked) {
      res.json({
        ...shared,
        lesson: {
          id: lesson.id,
          slug: lesson.slug,
          title: lesson.title,
          moduleId: lesson.moduleId,
          moduleTitle: lesson.moduleTitle,
          locked: true,
          unlocksAt: lesson.unlocksAt,
          unlockLabel: lesson.unlockLabel,
        },
      });
      return;
    }

    const [content, files] = await Promise.all([
      pool.query<LessonContentRow>(
        `SELECT body_md, video_url, audio_url, embed_html, transcript, captions_url,
                attachment_url
           FROM course_lessons WHERE id = $1`,
        [lesson.id]
      ),
      pool.query<{
        id: number;
        title: string;
        filename: string;
        mime: string;
        size_bytes: string | number;
      }>(
        `SELECT id, title, filename, mime, size_bytes
           FROM lesson_files WHERE lesson_id = $1 ORDER BY sort, id`,
        [lesson.id]
      ),
    ]);

    const body = content.rows[0];
    if (!body) throw notFound(LESSON_MISSING);

    // One instant for all four, so the player has a single moment to refresh
    // against rather than four expiries a few milliseconds apart.
    const mintedAt = new Date();
    const sign = (reference: string, kind: LessonMediaKind) =>
      playableUrl({ reference, kind, lessonId: lesson.id, memberId: member.id, now: mintedAt });

    const media = {
      video: sign(body.video_url, "lesson-video"),
      audio: sign(body.audio_url, "lesson-audio"),
      captions: sign(body.captions_url, "lesson-captions"),
      attachment: sign(body.attachment_url, "lesson-attachment"),
    };
    const mediaExpiresAt =
      [media.video, media.audio, media.captions, media.attachment]
        .map((signed) => signed.expiresAt)
        .find((value) => value !== null) ?? null;

    res.json({
      ...shared,
      lesson: {
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        contentType: lesson.contentType,
        moduleId: lesson.moduleId,
        moduleTitle: lesson.moduleTitle,
        locked: false,
        unlocksAt: null,
        unlockLabel: "",
        durationMinutes: lesson.durationMinutes,
        videoDurationSeconds: lesson.videoDurationSeconds,
        preview: lesson.preview,
        bodyMd: body.body_md,
        videoUrl: media.video.url,
        audioUrl: media.audio.url,
        // Author-written markup for an 'embed' lesson (a Vimeo iframe, a Typeform).
        // It comes from the admin, not from a member, and the player must still
        // render it in a sandboxed frame rather than into its own document.
        embedHtml: body.embed_html,
        transcript: body.transcript,
        captionsUrl: media.captions.url,
        attachmentUrl: media.attachment.url,
        // Null when nothing above needed signing. Otherwise the moment the four
        // URLs stop working, so a player left open through a long lesson can
        // reload this response before its source dies mid-sentence.
        mediaExpiresAt: mediaExpiresAt === null ? null : mediaExpiresAt.toISOString(),
        commentsEnabled: lesson.commentsEnabled,
        notesEnabled: lesson.notesEnabled,
        files: files.rows.map((f) => ({
          id: f.id,
          title: f.title || f.filename,
          filename: f.filename,
          mime: f.mime,
          sizeBytes: Number(f.size_bytes) || 0,
          downloadUrl: downloadLinkPath("lesson", f.id),
        })),
        progress: {
          completed: lesson.completed,
          completedAt: lesson.completedAt,
          lastPositionSeconds: lesson.lastPositionSeconds,
          watchedPercent: lesson.watchedPercent,
        },
      },
    });
  })
);

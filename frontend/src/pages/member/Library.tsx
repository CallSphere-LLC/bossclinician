import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Award,
  BookOpen,
  CalendarClock,
  FileDown,
  KeyRound,
  Layers,
  Loader2,
  Mail,
  Mic,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import {
  libraryApi,
  type ContinueLesson,
  type LibraryItem,
  type LibraryResponse,
} from "@/lib/libraryApi";
import { ProgressRing } from "@/components/player/ProgressRing";
import { contentTypeLabel } from "@/components/player/lessonMeta";
import { cn } from "@/lib/cn";

/**
 * The shelf — everything this member has paid for.
 *
 * Ordered by what somebody actually opens this page to do. First: get back into
 * the thing they were halfway through, which is one tap at the top and never
 * requires finding the course first. Then the shelf itself, grouped by kind with
 * courses at the front, because a course is the thing people came back for and a
 * PDF is the thing they came back for once.
 *
 * Entitlement is entirely the server's answer. Nothing here filters, hides or
 * decides — if a row is in the response the member owns it, and if it is not,
 * this page has never heard of it.
 */
export default function Library() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState("");
  // Course ids with a live certificate. Loaded beside the shelf, never before
  // it: the badge is a nicety, and a slow or failed read must not hold up — or
  // break — the page somebody opened to get back to a lesson.
  const [certifiedCourseIds, setCertifiedCourseIds] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );

  useEffect(() => {
    let cancelled = false;
    void libraryApi
      .getCertificates()
      .then(({ certificates }) => {
        if (cancelled) return;
        const ids = new Set<number>();
        for (const row of certificates) {
          if (!row.revoked && row.courseId !== null) ids.add(row.courseId);
        }
        setCertifiedCourseIds(ids);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await libraryApi.getLibrary());
      setError("");
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We could not open your library just now. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = data !== null && data.total === 0;

  return (
    <MemberShell
      title="Your library"
      description="Everything you own, in one place — courses, downloads and the rest, exactly where you left them."
    >
      <Seo title="Your library | Boss Clinician" />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && data === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Opening your library…
          </p>
        )}
      </div>

      {data && (
        <div className="flex flex-col gap-10">
          {data.continueLesson && <ContinueBand lesson={data.continueLesson} />}

          {data.expiringSoonCount > 0 && (
            <p className="flex items-start gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-sm text-gold-bright">
              <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {data.expiringSoonCount === 1
                  ? "One item in your library has access ending soon."
                  : `${data.expiringSoonCount} items in your library have access ending soon.`}{" "}
                Finish those first, or get in touch about extending them.
              </span>
            </p>
          )}

          {empty ? (
            <EmptyLibrary />
          ) : (
            data.groups.map((group) => (
              <section key={group.kind} aria-labelledby={`group-${group.kind}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id={`group-${group.kind}`} className="font-display text-xl text-white">
                    {group.label}
                  </h2>
                  <p className="text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
                    {group.items.length}
                  </p>
                </div>

                <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((item) => (
                    <li key={item.productId} className="flex">
                      <LibraryCard
                        item={item}
                        certified={item.courseId !== null && certifiedCourseIds.has(item.courseId)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </MemberShell>
  );
}

/* ------------------------------------------------------------ continue band */

/**
 * "Pick up where you left off".
 *
 * The single loudest thing on the page, on purpose: for anyone mid-course this
 * is the only control they wanted, and every extra decision between them and the
 * next lesson is a reason to close the tab instead.
 */
function ContinueBand({ lesson }: { lesson: ContinueLesson }) {
  const partial = lesson.watchedPercent > 0 && lesson.watchedPercent < 100;

  return (
    <GlassCard
      accent="gold"
      spotlight={false}
      // The one thing on this page worth reading first, and the thing the agent
      // is asked for most: where did I get to.
      data-narrate=""
      data-narrate-label="Pick up where you left off"
      className="p-5 sm:p-7"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
            Pick up where you left off
          </p>
          <h2 className="mt-2.5 text-balance font-display text-[1.35rem] leading-snug text-white sm:text-[1.6rem]">
            {lesson.title}
          </h2>
          <p className="mt-1.5 truncate text-sm text-orchid-dim">
            {lesson.moduleTitle} &middot; {contentTypeLabel(lesson.contentType)}
          </p>

          {partial && (
            <div className="mt-4 max-w-sm">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={lesson.watchedPercent}
                aria-valuetext={`${lesson.watchedPercent}% of this lesson watched`}
                className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]"
              >
                <div
                  className="h-full rounded-full bg-gold-foil"
                  style={{ width: `${lesson.watchedPercent}%` }}
                />
              </div>
              <p className="mt-1.5 text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
                {lesson.watchedPercent}% through
              </p>
            </div>
          )}
        </div>

        <LuxeButton to={lesson.href} className="shrink-0 self-start sm:self-auto">
          <Play aria-hidden className="size-4" />
          {partial ? "Keep going" : "Start"}
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

/* -------------------------------------------------------------------- cards */

const KIND_ICONS: Record<string, typeof BookOpen> = {
  course: BookOpen,
  community: Users,
  coaching: Sparkles,
  download: FileDown,
  podcast: Mic,
  newsletter: Mail,
  access_group: KeyRound,
  bundle: Layers,
};

function LibraryCard({ item, certified }: { item: LibraryItem; certified: boolean }) {
  const Icon = KIND_ICONS[item.kind] ?? BookOpen;
  const percent = item.progress?.percent ?? 0;

  const action = item.completed ? "Revisit" : item.started ? "Continue" : "Open";

  return (
    <GlassCard as="article" accent={item.completed ? "green" : "neutral"} className="flex w-full">
      {/* One link over the whole card rather than a link per element: a card with
          a linked title, a linked image and a linked button is three tab stops
          that all go to the same place. */}
      <Link
        to={item.href}
        className={cn(
          "flex w-full flex-col rounded-2xl",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-t-2xl bg-night-veil">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <span aria-hidden className="grid size-full place-items-center bg-plum-bright/[0.12]">
              <Icon className="size-8 text-gold/70" />
            </span>
          )}

          {item.expiringSoon && (
            <span className="absolute left-3 top-3">
              <LuxePill accent="gold" className="bg-night-deep/80 backdrop-blur">
                {item.expiresInDays === 0
                  ? "Ends today"
                  : item.expiresInDays === 1
                    ? "1 day left"
                    : `${item.expiresInDays ?? 0} days left`}
              </LuxePill>
            </span>
          )}

          {certified && (
            <span className="absolute right-3 top-3">
              <LuxePill accent="green" className="gap-1.5 bg-night-deep/80 backdrop-blur">
                <Award aria-hidden className="size-3" />
                Certificate earned
              </LuxePill>
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-4 sm:p-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-balance font-display text-[1.05rem] leading-snug text-white">
                {item.title}
              </h3>
              {item.subtitle && (
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-orchid-dim">
                  {item.subtitle}
                </p>
              )}
            </div>

            {item.progress && item.progress.lessonsTotal > 0 && (
              <ProgressRing
                percent={percent}
                label={`${item.progress.lessonsCompleted} of ${item.progress.lessonsTotal} lessons finished`}
              />
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 pt-1">
            <p className="text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
              {item.progress && item.progress.lessonsTotal > 0
                ? `${item.progress.lessonsCompleted} / ${item.progress.lessonsTotal} lessons`
                : item.kindLabel}
            </p>
            <p className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-gold">
              {action}
              <span aria-hidden>&rarr;</span>
            </p>
          </div>
        </div>
      </Link>
    </GlassCard>
  );
}

/* -------------------------------------------------------------- empty shelf */

/**
 * What everybody sees today, since nothing has been sold through this platform
 * yet. It is the first impression of the member area for every early customer,
 * so it points somewhere rather than apologising.
 */
function EmptyLibrary() {
  return (
    <GlassCard
      spotlight={false}
      interactive={false}
      className="flex flex-col items-center px-6 py-16 text-center sm:px-10"
    >
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
      >
        <BookOpen className="size-6 text-gold" />
      </span>

      <h2 className="mt-5 font-display text-[1.5rem] leading-snug text-white">
        Your shelf is waiting
      </h2>
      <p className="copy-luxe mt-3 max-w-md text-balance">
        Everything you buy lands here the moment it is yours — courses to work through, worksheets to
        download, and the sessions you have booked. Nothing to open just yet.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <LuxeButton to="/courses">Browse the courses</LuxeButton>
        <LuxeButton to="/work-with-me" variant="glass">
          Work with Yvette
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

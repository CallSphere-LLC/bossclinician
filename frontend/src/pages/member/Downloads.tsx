import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, FileDown, Loader2, Lock } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import { Attachments } from "@/components/player/Attachments";
import {
  libraryApi,
  productPath,
  type DownloadListItem,
  type DownloadsResponse,
} from "@/lib/libraryApi";
import { cn } from "@/lib/cn";

/**
 * Every file the member owns, on one page.
 *
 * Worksheets live beside the lesson they belong to, which is the right place to
 * meet them and the wrong place to find them again six weeks later. This is the
 * "where was that PDF" page: the same files, grouped by what they came with, and
 * each one a single tap.
 *
 * Every row is a button, not a link, exactly as in the player — the bytes sit
 * behind a signed token minted per click for one member, so there is no href to
 * offer. A lesson attachment that has not opened yet is listed with its date
 * rather than hidden, for the same reason the course outline lists locked
 * lessons: the date is the answer to the question they were about to ask.
 */

interface DownloadGroup {
  key: string;
  title: string;
  /** Only a product has an address of its own in this payload; a course does not. */
  href: string | null;
  files: DownloadListItem[];
}

function groupFiles(files: DownloadListItem[]): DownloadGroup[] {
  const groups = new Map<string, DownloadGroup>();

  for (const file of files) {
    const key = file.kind === "product" ? `product:${file.productId}` : `course:${file.courseId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: (file.kind === "product" ? file.productTitle : file.courseTitle) || "Downloads",
        href: file.kind === "product" && file.productSlug ? productPath(file.productSlug) : null,
        files: [],
      };
      groups.set(key, group);
    }
    group.files.push(file);
  }

  // The server already orders files within a product or course; this keeps that
  // order and only puts the groups themselves in a predictable one.
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export default function Downloads() {
  const [data, setData] = useState<DownloadsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await libraryApi.getDownloads();
        if (!cancelled) {
          setData(response);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load your downloads just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => (data ? groupFiles(data.files) : []), [data]);

  return (
    <MemberShell
      title="Your downloads"
      description="Every worksheet, workbook and file that came with something you own — all in one place."
    >
      <Seo title="Your Downloads | Boss Clinician" />

      <Link
        to="/account"
        className={cn(
          "mb-6 inline-flex min-h-[2.75rem] items-center gap-2 rounded-full pr-3",
          "text-sm text-orchid transition-colors duration-300 hover:text-gold",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        <ArrowLeft aria-hidden className="size-4" />
        Your account
      </Link>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && data === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Gathering your files…
          </p>
        )}
      </div>

      {data && data.total === 0 && <NoDownloads />}

      {data && data.total > 0 && (
        <div className="flex flex-col gap-6">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
            {data.availableCount} of {data.total} {data.total === 1 ? "file" : "files"} ready to
            download
          </p>

          {groups.map((group) => (
            <DownloadGroupCard key={group.key} group={group} />
          ))}
        </div>
      )}
    </MemberShell>
  );
}

function DownloadGroupCard({ group }: { group: DownloadGroup }) {
  // One kind per group by construction: a group is one product or one course.
  const kind = group.files[0]?.kind ?? "product";
  const available = group.files
    .filter((file) => file.available)
    .map((file) => ({
      id: file.id,
      title: file.title,
      filename: file.filename,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      description: contextLine(file) || undefined,
    }));
  const locked = group.files.filter((file) => !file.available);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h2 className="flex items-center gap-2.5 font-display text-base text-white">
        <FileDown aria-hidden className="size-4 shrink-0 text-gold" />
        {group.href ? (
          <Link
            to={group.href}
            className={cn(
              "truncate transition-colors duration-300 hover:text-gold-bright",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            )}
          >
            {group.title}
          </Link>
        ) : (
          <span className="truncate">{group.title}</span>
        )}
      </h2>

      {/* View and Download for each file, the same rows a lesson shows. */}
      <Attachments files={available} kind={kind} bare className="mt-3.5" />

      {locked.length > 0 && (
        <ul className={cn("flex flex-col gap-2", available.length > 0 ? "mt-2" : "mt-3.5")}>
          {locked.map((file) => (
            <li key={`${file.kind}:${file.id}`}>
              <LockedRow file={file} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where in the course a lesson's file came from; a product file says what it is instead. */
function contextLine(file: DownloadListItem): string {
  if (file.kind === "lesson") {
    return [file.moduleTitle, file.lessonTitle].filter(Boolean).join(" · ");
  }
  return file.description;
}

function LockedRow({ file }: { file: DownloadListItem }) {
  const context = contextLine(file);

  return (
    <div className="flex min-h-[2.75rem] w-full items-center gap-3 rounded-xl border border-white/[0.07] px-3.5 py-3">
      <span className="min-w-0 flex-1">
        <span className="sr-only">Locked. </span>
        <span className="block truncate text-sm font-medium text-white/55">{file.title}</span>
        {context && (
          <span className="mt-0.5 block text-xs leading-relaxed text-orchid-faint">{context}</span>
        )}
        <span className="mt-0.5 block text-[0.7rem] text-gold/80">
          {file.unlockLabel || "Not open yet"}
        </span>
      </span>
      <Lock aria-hidden className="size-4 shrink-0 text-orchid-faint" />
    </div>
  );
}

function NoDownloads() {
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
        <FileDown className="size-6 text-gold" />
      </span>
      <h2 className="mt-5 font-display text-[1.5rem] leading-snug text-white">
        Nothing to download just yet
      </h2>
      <p className="copy-luxe mt-3 max-w-md text-balance">
        When a course or resource you own comes with a worksheet or a workbook, it will be waiting
        for you here as well as beside its lesson.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <LuxeButton to="/library">Back to your library</LuxeButton>
      </div>
    </GlassCard>
  );
}

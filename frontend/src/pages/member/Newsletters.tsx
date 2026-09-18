import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { ChevronDown, Lock, Loader2, Mail } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import {
  publishingApi,
  type EmailTopic,
  type NewsletterHome,
  type NewsletterIssue,
  type NewsletterPublication,
} from "@/lib/publishingApi";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

/**
 * The newsletter archive, and what lands in the member's inbox.
 *
 * Preferences are per-topic rather than one master switch, because a single
 * switch turns "stop the weekly digest" into "never hear from Yvette again" —
 * and a member who only wanted the first will take the second when it is the
 * only button offered. Each toggle saves on its own, immediately, with no Save
 * button to forget.
 */
export default function Newsletters() {
  const [home, setHome] = useState<NewsletterHome | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await publishingApi.newsletters();
        if (!cancelled) {
          setHome(data);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load your newsletters just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPublication = useCallback((updated: NewsletterPublication) => {
    setHome((current) =>
      current
        ? {
            ...current,
            publications: current.publications.map((row) =>
              row.id === updated.id ? updated : row,
            ),
          }
        : current,
    );
  }, []);

  const applyTopic = useCallback((updated: EmailTopic) => {
    setHome((current) =>
      current
        ? {
            ...current,
            topics: current.topics.map((row) => (row.topic === updated.topic ? updated : row)),
          }
        : current,
    );
  }, []);

  return (
    <MemberShell
      title="Newsletters"
      description="Every issue Yvette has sent, and exactly which emails you want from here on."
    >
      <Seo title="Newsletters | Boss Clinician" />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && home === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading your newsletters…
          </p>
        )}
      </div>

      {home && (
        <div className="grid gap-6">
          <PreferencesCard
            publications={home.publications}
            topics={home.topics}
            onPublicationSaved={applyPublication}
            onTopicSaved={applyTopic}
          />
          <ArchiveCard issues={home.issues} />
        </div>
      )}
    </MemberShell>
  );
}

/* ── Preferences ────────────────────────────────────────────────────────── */

function PreferencesCard({
  publications,
  topics,
  onPublicationSaved,
  onTopicSaved,
}: {
  publications: NewsletterPublication[];
  topics: EmailTopic[];
  onPublicationSaved: (row: NewsletterPublication) => void;
  onTopicSaved: (row: EmailTopic) => void;
}) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-7">
      <h2 className="font-display text-xl text-white">What you get by email</h2>
      <p className="copy-luxe mt-2 max-w-xl text-sm">
        Every switch saves as you set it. Turning one off never affects the others, and never stops
        the emails about things you have paid for.
      </p>

      {publications.length > 0 && (
        <>
          <h3 className="mt-7 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            Newsletters
          </h3>
          <ul className="mt-1 divide-y divide-white/[0.07]">
            {publications.map((row) => (
              <li key={row.id}>
                <PreferenceRow
                  title={row.name}
                  description={
                    row.description ||
                    `${row.issueCount} ${row.issueCount === 1 ? "issue" : "issues"} so far${
                      row.latestIssueAt ? ` · latest ${formatDate(row.latestIssueAt)}` : ""
                    }`
                  }
                  subscribed={row.subscribed}
                  onChange={(next) => publishingApi.setPublicationSubscribed(row.id, next)}
                  onSaved={onPublicationSaved}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {topics.length > 0 && (
        <>
          <h3 className="mt-7 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            Other emails
          </h3>
          <ul className="mt-1 divide-y divide-white/[0.07]">
            {topics.map((row) => (
              <li key={row.topic}>
                {row.essential ? (
                  <div className="flex items-center gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">{row.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-orchid-faint">
                        {row.description}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-orchid-dim">
                      <Lock aria-hidden className="size-3" />
                      Always on
                    </span>
                  </div>
                ) : (
                  <PreferenceRow
                    title={row.label}
                    description={row.description}
                    subscribed={row.subscribed}
                    onChange={(next) => publishingApi.setTopicSubscribed(row.topic, next)}
                    onSaved={onTopicSaved}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </GlassCard>
  );
}

/**
 * One switch, saving itself.
 *
 * Optimistic: the switch moves on the tap and moves back if the save fails,
 * because a toggle that waits on a round trip reads as broken on a phone with
 * one bar of signal.
 */
function PreferenceRow<T>({
  title,
  description,
  subscribed,
  onChange,
  onSaved,
}: {
  title: string;
  description: string;
  subscribed: boolean;
  onChange: (subscribed: boolean) => Promise<T>;
  onSaved: (row: T) => void;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const checked = optimistic ?? subscribed;

  const toggle = async () => {
    const next = !checked;
    setOptimistic(next);
    setSaving(true);
    try {
      onSaved(await onChange(next));
      setOptimistic(null);
    } catch (err) {
      setOptimistic(null);
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not save that just now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-orchid-faint">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={saving}
        onClick={() => void toggle()}
        className={cn(
          // 44px of tappable height around a 24px track: the switch is the
          // densest control on the page and a mis-tap here unsubscribes someone.
          "relative grid h-11 w-16 shrink-0 place-items-center rounded-full",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          "disabled:opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-6 w-11 rounded-full border transition-colors duration-300",
            checked ? "border-gold/50 bg-gold/[0.35]" : "border-white/15 bg-ink/[0.08]",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "absolute size-4 rounded-full transition-transform duration-300 ease-luxe",
            checked ? "translate-x-3 bg-gold" : "-translate-x-3 bg-ink/50",
          )}
        />
      </button>
    </div>
  );
}

/* ── Archive ────────────────────────────────────────────────────────────── */

function ArchiveCard({ issues }: { issues: NewsletterIssue[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-7">
      <h2 className="font-display text-xl text-white">Every issue</h2>

      {issues.length === 0 ? (
        <div className="mt-6 flex flex-col items-center py-10 text-center">
          <span
            aria-hidden
            className="grid size-12 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
          >
            <Mail className="size-5 text-gold" />
          </span>
          <p className="copy-luxe mt-4 max-w-sm text-balance text-sm">
            Nothing in the archive yet. Issues appear here the moment they go out, so you never have
            to dig through your inbox for one.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-white/[0.07]">
          {issues.map((issue) => {
            const open = openId === issue.id;
            return (
              <li key={issue.id}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : issue.id)}
                    aria-expanded={open}
                    aria-controls={`issue-${issue.id}`}
                    className={cn(
                      "flex w-full min-h-[3.5rem] items-start gap-4 py-4 text-left",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-white">{issue.subject}</span>
                      <span className="mt-1 block text-xs text-orchid-faint">
                        {issue.newsletterName}
                        {issue.sentAt && ` · ${formatDate(issue.sentAt)}`}
                      </span>
                      {issue.previewText && !open && (
                        <span className="copy-luxe mt-1.5 line-clamp-1 text-sm">
                          {issue.previewText}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "mt-1 size-4 shrink-0 text-orchid-dim transition-transform duration-300",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                </h3>

                {open && (
                  <div id={`issue-${issue.id}`} className="pb-6">
                    {issue.bodyMd ? (
                      <div className="prose-boss max-w-2xl break-words [&_table]:block [&_table]:overflow-x-auto">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{issue.bodyMd}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="copy-luxe text-sm">
                        This issue has nothing on file to show — it may have been sent before the
                        archive existed.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div aria-hidden className="rule-faint my-6 w-full" />
      <p className="copy-luxe text-sm">
        Looking for a receipt or an invoice rather than a newsletter?
      </p>
      <div className="mt-3">
        <LuxeButton to="/account/purchases" variant="quiet">
          Your purchases
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Lock, Loader2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { PreferenceSwitch } from "@/components/member/PreferenceSwitch";
import { GlassCard } from "@/components/luxe/GlassCard";
import { MemberApiError } from "@/lib/memberApi";
import {
  publishingApi,
  type EmailTopic,
  type NewsletterHome,
  type NewsletterPublication,
} from "@/lib/publishingApi";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

/**
 * Email preferences, where somebody looks for them: under the account.
 *
 * The switches are the same ones the Newsletters page carries, saved through
 * the same two endpoints, one at a time. This page exists because "how do I stop
 * these emails" is an account question, and a member who does not read the
 * newsletter has no reason to go looking for the answer inside its archive.
 */
export default function EmailPreferences() {
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
            : "We could not load your email preferences just now. Please try again.",
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

  const nothingToSet = home !== null && home.publications.length === 0 && home.topics.length === 0;

  return (
    <MemberShell
      title="Email preferences"
      description="Choose exactly which emails you would like from us. Each switch saves as you set it."
    >
      <Seo title="Email Preferences | Boss Clinician" />

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
        {!error && home === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading your preferences…
          </p>
        )}
      </div>

      {home && (
        <div className="grid gap-6">
          <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-7">
            <h2 className="font-display text-xl text-white">What you get by email</h2>
            <p className="copy-luxe mt-2 max-w-xl text-sm">
              Turning one off never affects the others, and never stops the emails about things you
              have paid for.
            </p>

            {nothingToSet && (
              <p className="mt-6 text-sm text-orchid-dim">
                There is nothing to switch on or off just yet.
              </p>
            )}

            {home.publications.length > 0 && (
              <>
                <h3 className="mt-7 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                  Newsletters
                </h3>
                <ul className="mt-1 divide-y divide-white/[0.07]">
                  {home.publications.map((row) => (
                    <li key={row.id}>
                      <PreferenceSwitch
                        title={row.name}
                        description={
                          row.description ||
                          `${row.issueCount} ${row.issueCount === 1 ? "issue" : "issues"} so far${
                            row.latestIssueAt ? ` · latest ${formatDate(row.latestIssueAt)}` : ""
                          }`
                        }
                        subscribed={row.subscribed}
                        onChange={(next) => publishingApi.setPublicationSubscribed(row.id, next)}
                        onSaved={applyPublication}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            {home.topics.length > 0 && (
              <>
                <h3 className="mt-7 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                  Other emails
                </h3>
                <ul className="mt-1 divide-y divide-white/[0.07]">
                  {home.topics.map((row) => (
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
                        <PreferenceSwitch
                          title={row.label}
                          description={row.description}
                          subscribed={row.subscribed}
                          onChange={(next) => publishingApi.setTopicSubscribed(row.topic, next)}
                          onSaved={applyTopic}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </GlassCard>

          <p className="text-sm text-orchid-dim">
            Looking for a past issue?{" "}
            <Link
              to="/newsletters"
              className="text-orchid underline decoration-white/20 underline-offset-[6px] transition-colors duration-300 hover:text-gold hover:decoration-gold/60"
            >
              Open the newsletter archive
            </Link>
          </p>
        </div>
      )}
    </MemberShell>
  );
}

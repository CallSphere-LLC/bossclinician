import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { RetreatDashboard } from "@/components/retreats/RetreatDashboard";
import { BUTTON_OUTLINE, LINK } from "@/components/retreats/retreatUi";
import { MemberApiError } from "@/lib/memberApi";
import {
  formatRetreatRange,
  memberRetreatsApi,
  type MyRetreat,
  type RetreatDashboardData,
  type RetreatSectionId,
} from "@/lib/retreatsApi";

/**
 * /retreats/dashboard[/:slug[/:section]] — the guest's private FlourisHealer
 * Retreat Dashboard, inside the member portal (RequireMember sends a signed-out
 * visitor to /login?next=… and back here afterwards).
 *
 * The three section addresses are the stable deep links the post-retreat
 * alumni emails use: /memories, /feedback and /interest. They open the whole
 * dashboard and move focus to that section.
 */

const SUPPORT = "retreats@bossclinician.com";
const SECTION_LINKS: Record<string, RetreatSectionId> = {
  memories: "memories",
  feedback: "feedback",
  interest: "interest",
};

export default function RetreatDashboardPage() {
  const { slug, section } = useParams<{ slug?: string; section?: string }>();
  if (!slug) return <RetreatIndex />;
  return <RetreatScreen slug={slug} focusSection={section ? SECTION_LINKS[section] : undefined} />;
}

function RetreatIndex() {
  const [retreats, setRetreats] = useState<MyRetreat[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    memberRetreatsApi
      .mine()
      .then((result) => !cancelled && setRetreats(result.retreats))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "We couldn't open your retreats."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (retreats && retreats.length === 1) return <Navigate to={`/retreats/dashboard/${encodeURIComponent(retreats[0].slug)}`} replace />;

  return (
    <MemberShell title="FlourisHealer Retreats" description="Your private retreat dashboards.">
      <Seo title="FlourisHealer Retreats | Boss Clinician" />
      {error && <p role="alert" className="text-sm font-medium text-red-400">{error}</p>}
      {!error && retreats === null && <Loading text="Opening your retreats…" />}
      {retreats && retreats.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-orchid">
          <h2 className="font-display text-xl text-white">No retreat dashboards yet</h2>
          <p className="mt-2">
            Your retreat dashboard appears here once your booking is confirmed. Questions? Email{" "}
            <a className={LINK} href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.
          </p>
        </div>
      )}
      {retreats && retreats.length > 1 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {retreats.map((retreat) => (
            <li key={retreat.slug}>
              <Link
                to={`/retreats/dashboard/${encodeURIComponent(retreat.slug)}`}
                className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-gold/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                <span className="block font-display text-lg text-white">{retreat.title}</span>
                <span className="mt-1 block text-sm text-orchid">
                  {retreat.location} · {formatRetreatRange(retreat.startDate, retreat.endDate)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MemberShell>
  );
}

function RetreatScreen({ slug, focusSection }: { slug: string; focusSection?: RetreatSectionId }) {
  const [data, setData] = useState<RetreatDashboardData | null>(null);
  const [error, setError] = useState<{ message: string; missing: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    memberRetreatsApi
      .dashboard(slug)
      .then((next) => setData(next))
      .catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    memberRetreatsApi
      .dashboard(slug)
      .then((next) => !cancelled && setData(next))
      .catch((e) => {
        if (cancelled) return;
        const missing = e instanceof MemberApiError && (e.status === 404 || e.status === 403);
        setError({ message: missing ? "We couldn't find that retreat dashboard." : e instanceof Error ? e.message : "We couldn't open your dashboard.", missing });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const title = data?.dashboardTitle ?? "YOUR RETREAT DASHBOARD";
  const description = data ? `${data.retreat.title} · ${formatRetreatRange(data.retreat.startDate, data.retreat.endDate)}` : undefined;

  return (
    <MemberShell title={title} description={description}>
      <Seo title="Your Retreat Dashboard | Boss Clinician" />
      <div aria-live="polite">
        {error && (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm font-medium text-red-400">{error.message}</p>
            {error.missing ? (
              <MissingRetreatAccessHelp />
            ) : (
              <div>
                <button type="button" className={BUTTON_OUTLINE} onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
        {!error && data === null && <Loading text="Opening your retreat dashboard…" />}
      </div>
      {data && <RetreatDashboard data={data} slug={slug} onReload={reload} focusSection={focusSection} />}
    </MemberShell>
  );
}

export function MissingRetreatAccessHelp() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-orchid">
        If you booked with a different email than you use to sign in, email{" "}
        <a className={LINK} href={`mailto:${SUPPORT}`}>{SUPPORT}</a>{" "}
        for help verifying your booking and restoring access.
      </p>
      <p className="text-sm text-orchid">
        If you expected to see a retreat dashboard here, contact us at{" "}
        <a className={LINK} href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.
      </p>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {text}
    </p>
  );
}

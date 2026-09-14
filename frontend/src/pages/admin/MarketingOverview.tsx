import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  ListOrdered,
  Mail,
  Megaphone,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { marketingApi, type MarketingOverview as Overview } from "@/lib/marketingApi";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Marketing → Overview.
 *
 * The one Marketing screen Kajabi has that this console lacked: a single page
 * that says how the whole email programme is doing before she opens any list.
 * Five tiles — emails, sequences, form replies, automations, events — each read
 * live from the same tables as the list it links to, so a number here never
 * disagrees with the screen one click away.
 *
 * Deep links: none of the underlying list screens reads a filter from the
 * address yet, so each tile links to the list itself, and to the one filtered
 * view that does exist where there is one (a single sequence, a single form
 * with its replies, the email reports that open on the last thirty days).
 */

export default function MarketingOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    marketingApi
      .overview()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, "marketing overview"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  const days = data?.windowDays ?? 30;

  const nothingYet =
    data !== null &&
    data.emails.sent === 0 &&
    data.emails.notSent === 0 &&
    data.sequences.total === 0 &&
    data.forms.replies === 0 &&
    data.automations.runs === 0 &&
    data.automations.active === 0 &&
    data.events.upcoming === 0 &&
    data.events.alwaysOn === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Overview"
        description={`How your emails, sequences, forms, automations and events are doing over the last ${days} days.`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} />
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button asChild size="sm">
              <Link to="/admin/marketing/campaigns">
                <Mail />
                Write an email
              </Link>
            </Button>
          </>
        }
      />

      {error && (
        <div className="space-y-3">
          <ErrorNotice message={error} />
          <Button variant="secondary" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {data && (
        <p className="text-xs text-ink-soft">
          Worked out {formatRelative(data.generatedAt)}, straight from your lists.
        </p>
      )}

      {data === null && !error ? (
        <OverviewSkeleton />
      ) : data ? (
        <>
          {nothingYet && (
            <Card>
              <EmptyState
                icon={<Megaphone />}
                title="Nothing to report yet"
                description="Once you send an email, start a sequence, get a form reply, switch on an automation or schedule an event, you'll see how it's going here."
                action={
                  <div className="flex flex-wrap justify-center gap-2.5">
                    <Button asChild size="sm">
                      <Link to="/admin/marketing/campaigns">Write an email</Link>
                    </Button>
                    <Button asChild variant="secondary" size="sm">
                      <Link to="/admin/marketing/sequences">Start a sequence</Link>
                    </Button>
                    <Button asChild variant="secondary" size="sm">
                      <Link to="/admin/marketing/events-v2">Schedule an event</Link>
                    </Button>
                  </div>
                }
              />
            </Card>
          )}

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <EmailsTile data={data} />
            <SequencesTile data={data} />
            <FormsTile data={data} />
            <AutomationsTile data={data} />
            <EventsTile data={data} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ tiles */

/** "6 from campaigns · 5 from sequences · 0 from automations" — always all three, so the sum is checkable. */
function bySourceText(split: Overview["emails"]["bySource"]): string {
  return [
    `${formatNumber(split.broadcast)} from campaigns`,
    `${formatNumber(split.sequence)} from sequences`,
    `${formatNumber(split.automation)} from automations`,
  ].join(" · ");
}

/**
 * Every email figure here counts rows in the delivery log — one per recipient
 * per attempt — over the same last-N-days window, so "sent", "didn't send" and
 * "waiting" add up to every marketing email in that window. Each breakdown sits
 * next to the figure it adds up to and says which one that is: the source split
 * of the headline used to sit under "Didn't send" and read as its breakdown.
 */
function EmailsTile({ data }: { data: Overview }) {
  const { emails, windowDays } = data;
  const rate = (value: number | null) => (value === null ? "—" : `${value}%`);
  const retried = emails.notSentEmails < emails.notSent;
  const stillUnsent = emails.notSentEmails - emails.notSentLaterSent;
  return (
    <Tile
      className="md:col-span-2 xl:col-span-2"
      label="Marketing emails sent"
      icon={<Mail className="size-4" />}
      value={emails.sent}
      caption={
        emails.sent === 0
          ? `None handed to your mail service in the last ${windowDays} days`
          : `Last ${windowDays} days, counting each email to each person: ${bySourceText(emails.bySource)}`
      }
      links={[
        { to: "/admin/marketing/campaigns?type=campaign&status=sent", label: "See your sent campaigns" },
        { to: "/admin/analytics/reports/email-broadcasts", label: `Broadcast report, last ${windowDays} days` },
        { to: "/admin/analytics/reports/email-sequences", label: `Sequence report, last ${windowDays} days` },
      ]}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure
          label="Opened"
          value={rate(emails.openRate)}
          sub={`${formatNumber(emails.opened)} of ${pluralize(emails.sent, "email")}`}
        />
        <Figure
          label="Clicked"
          value={rate(emails.clickRate)}
          sub={`${formatNumber(emails.clicked)} of ${pluralize(emails.sent, "email")}`}
        />
        <Figure
          label="Campaigns sent"
          value={formatNumber(emails.campaignsSent)}
          sub={
            emails.campaignsScheduled > 0
              ? `Last ${windowDays} days · ${formatNumber(emails.campaignsScheduled)} scheduled`
              : `Campaigns, last ${windowDays} days`
          }
        />
        <Figure
          label="Didn't send"
          value={formatNumber(emails.notSent)}
          sub={
            emails.notSent > 0
              ? `${emails.notSent === 1 ? "Attempt" : "Attempts"} to ${pluralize(emails.notSentPeople, "person", "people")}`
              : "Every attempt went out"
          }
          tone={stillUnsent > 0 ? "warn" : undefined}
        />
      </div>
      <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-ink-soft">
        {emails.broadcastUnlisted > 0 && (
          <p>
            {emails.broadcastUnlisted === emails.bySource.broadcast
              ? `All ${formatNumber(emails.broadcastUnlisted)} campaign emails`
              : `${formatNumber(emails.broadcastUnlisted)} of the ${formatNumber(emails.bySource.broadcast)} campaign emails`}{" "}
            came from campaigns that are no longer on your campaigns list, so Campaigns sent doesn't count them.
          </p>
        )}
        {emails.notSent > 0 && (
          <p>
            <span className="font-semibold text-ink">Didn't send, {formatNumber(emails.notSent)}:</span>{" "}
            {bySourceText(emails.notSentBySource)}.
            {retried && ` They were ${formatNumber(emails.notSent)} tries at ${pluralize(emails.notSentEmails, "email")}`}
            {retried && (emails.notSentLaterSent > 0 ? "" : ".")}
            {emails.notSentLaterSent > 0 &&
              (stillUnsent === 0
                ? `${retried ? "," : ""} ${emails.notSentEmails === 1 ? "and it" : "and all of them"} went out on a later try.`
                : `${retried ? ";" : ""} ${formatNumber(emails.notSentLaterSent)} of ${pluralize(emails.notSentEmails, "email")} went out on a later try.`)}{" "}
            <Link to="/admin/settings/email/log" className="font-semibold text-plum hover:underline">
              See why in the delivery log
            </Link>
            .
          </p>
        )}
        {emails.queued > 0 && (
          <p>{pluralize(emails.queued, "email is", "emails are")} still waiting to go out, counted in neither figure.</p>
        )}
        {emails.sent > 0 && !emails.trackingSeen && (
          <p>No opens or clicks have been reported yet, so the rates may read low until your mail service starts sending them back.</p>
        )}
      </div>
    </Tile>
  );
}

function SequencesTile({ data }: { data: Overview }) {
  const { sequences } = data;
  return (
    <Tile
      label="Active sequences"
      icon={<ListOrdered className="size-4" />}
      value={sequences.active}
      caption={
        sequences.total === 0
          ? "You haven't made a sequence yet"
          : sequences.people === sequences.enrolled
            ? `Switched on now · ${pluralize(sequences.enrolled, "person", "people")} going through them right now`
            : `Switched on now · ${formatNumber(sequences.enrolled)} enrolments right now, ${pluralize(sequences.people, "different person", "different people")}`
      }
      links={[{ to: "/admin/marketing/sequences?status=active", label: "See your active sequences" }]}
    >
      <NamedList
        empty={
          sequences.total === 0
            ? "Sequences send a run of emails, one after another, to everyone who joins."
            : "None are switched on right now."
        }
        rows={sequences.top.map((row) => ({
          key: row.id,
          to: `/admin/marketing/sequences/${row.id}`,
          name: row.name,
          value: `${pluralize(row.enrolled, "person", "people")} in it now`,
        }))}
      />
      {sequences.active > sequences.top.length && (
        <ShowingNote shown={sequences.top.length} of={sequences.active} what="active sequences, most people first" />
      )}
    </Tile>
  );
}

function FormsTile({ data }: { data: Overview }) {
  const { forms, windowDays } = data;
  const change = forms.replies - forms.previousReplies;
  return (
    <Tile
      label="Form replies"
      icon={<ClipboardList className="size-4" />}
      value={forms.replies}
      caption={
        forms.replies === 0 && forms.previousReplies === 0
          ? `No replies in the last ${windowDays} days, or the ${windowDays} before`
          : `Last ${windowDays} days, across ${pluralize(forms.formsWithReplies, "form")} · ${formatNumber(forms.previousReplies)} in the ${windowDays} days before (${
              change === 0 ? "no change" : `${change > 0 ? "+" : "−"}${formatNumber(Math.abs(change))}`
            })`
      }
      links={[{ to: "/admin/marketing/forms-v2", label: "See your forms" }]}
    >
      <NamedList
        empty="Replies show up here as people fill in the forms on your site."
        rows={forms.top.map((row) => ({
          key: row.id,
          // FormBuilder opens a form, with its replies, from ?form=<id>; since=
          // narrows those replies to the same window this tile counts.
          to: `/admin/marketing/forms-v2?form=${row.id}&since=${windowDays}d`,
          name: row.name,
          value: `${pluralize(row.replies, "reply", "replies")}, last ${windowDays} days`,
        }))}
      />
      {forms.formsWithReplies > forms.top.length && (
        <ShowingNote shown={forms.top.length} of={forms.formsWithReplies} what="forms with replies, most replies first" />
      )}
    </Tile>
  );
}

function AutomationsTile({ data }: { data: Overview }) {
  const { automations, windowDays } = data;
  const troubled = automations.withProblems > 0;
  return (
    <Tile
      label="Automations that ran"
      icon={<Workflow className="size-4" />}
      value={automations.ran}
      caption={
        automations.runs === 0
          ? `Nothing ran in the last ${windowDays} days · ${formatNumber(automations.active)} switched on now`
          : `Last ${windowDays} days · ${pluralize(automations.runs, "run")} between them, practice runs and skips not counted · ${formatNumber(automations.active)} switched on now`
      }
      links={[{ to: "/admin/marketing/automations-v2", label: "See your automations" }]}
      badge={
        automations.runs > 0 ? (
          troubled ? (
            <Badge tone="gold">
              <AlertTriangle className="size-3" />
              {formatNumber(automations.withProblems)} of {formatNumber(automations.ran)} had problems
            </Badge>
          ) : (
            <Badge tone="green">No problems</Badge>
          )
        ) : null
      }
    >
      {troubled ? (
        <>
          <p className="mb-2 text-xs text-ink-soft">
            {formatNumber(automations.problemRuns)} of those {pluralize(automations.runs, "run")} ran with problems or
            didn't run
            {automations.failedRuns > 0 ? ` (${formatNumber(automations.failedRuns)} didn't run at all)` : ""}:
          </p>
          <NamedList
            empty=""
            rows={automations.problemAutomations.map((row) => ({
              key: row.id,
              to: `/admin/marketing/automations-v2?automation=${row.id}`,
              name: row.name,
              value: pluralize(row.problemRuns, "problem run"),
              tone: "warn" as const,
            }))}
          />
          {automations.withProblems > automations.problemAutomations.length && (
            <ShowingNote
              shown={automations.problemAutomations.length}
              of={automations.withProblems}
              what="automations with problems, most problem runs first"
            />
          )}
          {automations.skippedRuns > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              {pluralize(automations.skippedRuns, "run was", "runs were")} skipped because the person didn't match.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs leading-relaxed text-ink-soft">
          {automations.runs === 0
            ? "When an automation runs, you'll see here whether it did everything it was meant to."
            : "Every run did everything it was meant to."}
          {automations.skippedRuns > 0 &&
            ` ${pluralize(automations.skippedRuns, "run was", "runs were")} skipped because the person didn't match.`}
        </p>
      )}
    </Tile>
  );
}

function EventsTile({ data }: { data: Overview }) {
  const { events } = data;
  // Always-on and community events are separate lists: named, never added in.
  const alsoComing = [
    events.alwaysOn > 0 ? pluralize(events.alwaysOn, "always-on event") : null,
    events.communityUpcoming > 0 ? `${pluralize(events.communityUpcoming, "community event")} coming up` : null,
  ].filter(Boolean);
  return (
    <Tile
      label="Upcoming live events"
      icon={<CalendarDays className="size-4" />}
      value={events.upcoming}
      caption={
        events.upcoming === 0
          ? "No live events still to start"
          : `Still to start${events.upcomingDrafts > 0 ? `, ${formatNumber(events.upcomingDrafts)} not published` : ""} · ${pluralize(
              events.registrations,
              "person",
              "people",
            )} registered for them`
      }
      links={[
        { to: "/admin/marketing/events-v2?when=upcoming", label: "See events still to come" },
        ...(events.communityUpcoming > 0
          ? [{ to: "/admin/marketing/events", label: "Community events" }]
          : []),
      ]}
    >
      <NamedList
        empty="Schedule a webinar or live class and it will show here until it starts."
        rows={events.next.map((row) => ({
          key: row.id,
          to: `/admin/marketing/events-v2?event=${row.id}`,
          name: row.title,
          value: formatDateTime(row.startsAt),
          note: `${row.published ? "" : "Not published · "}${formatNumber(row.registrations)} registered`,
        }))}
      />
      {events.upcoming > events.next.length && (
        <ShowingNote shown={events.next.length} of={events.upcoming} what="live events still to start, soonest first" />
      )}
      {alsoComing.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">Not counted above: {alsoComing.join(" · ")}.</p>
      )}
    </Tile>
  );
}

/* --------------------------------------------------------------- pieces */

interface TileLink {
  to: string;
  label: string;
}

function Tile({
  label,
  icon,
  value,
  caption,
  links,
  badge,
  className,
  children,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  caption: string;
  links: TileLink[];
  badge?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [primary, ...rest] = links;
  return (
    <Card className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">{label}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link
                to={primary.to}
                className="font-display text-[1.9rem] leading-none text-ink hover:text-plum"
                aria-label={`${label}: ${formatNumber(value)}. ${primary.label}`}
              >
                {formatNumber(value)}
              </Link>
              {badge}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{caption}</p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/[0.12] text-gold">
            {icon}
          </span>
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline/60 px-5 py-2.5">
        <Link
          to={primary.to}
          className="inline-flex items-center gap-1 text-xs font-semibold text-plum hover:underline"
        >
          {primary.label}
          <ArrowUpRight className="size-3.5" />
        </Link>
        {rest.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink hover:underline"
          >
            {link.label}
            <ArrowUpRight className="size-3" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "warn";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-hairline/70 bg-white/[0.03] px-3 py-2.5">
      {/* Wrap rather than truncate: the sub line is where a figure says what it counts and over when. */}
      <p className="break-words text-[0.66rem] font-semibold uppercase leading-snug tracking-[0.1em] text-ink-soft">
        {label}
      </p>
      <p className={cn("mt-1 font-display text-xl leading-none", tone === "warn" ? "text-gold" : "text-ink")}>
        {value}
      </p>
      <p className="mt-1 break-words text-[0.7rem] leading-snug text-ink-soft">{sub}</p>
    </div>
  );
}

function NamedList({
  rows,
  empty,
}: {
  rows: { key: number; to: string; name: string; value: string; note?: string; tone?: "warn" }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return empty ? <p className="text-xs leading-relaxed text-ink-soft">{empty}</p> : null;
  }
  return (
    <ul className="divide-y divide-hairline/50 rounded-xl border border-hairline/60">
      {rows.map((row) => (
        <li key={row.key}>
          <Link
            to={row.to}
            className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-lilac-tint/25"
          >
            <span className="min-w-0 flex-1">
              {/* Wrap, never truncate: "ZZ Test — wel…" doesn't say which sequence it is. */}
              <span className="block break-words text-ink [overflow-wrap:anywhere]">{row.name}</span>
              {row.note && <span className="block break-words text-[0.7rem] leading-snug text-ink-soft">{row.note}</span>}
            </span>
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                row.tone === "warn" ? "font-semibold text-gold" : "text-ink-soft",
              )}
            >
              {row.value}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Says a top-N list is not the whole count, so nobody sums the rows and gets a different number. */
function ShowingNote({ shown, of, what }: { shown: number; of: number; what: string }) {
  return (
    <p className="mt-2 text-[0.7rem] text-ink-soft">
      Showing {formatNumber(shown)} of {formatNumber(of)} {what}.
    </p>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading your marketing overview">
      <Skeleton className="h-52 w-full md:col-span-2" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

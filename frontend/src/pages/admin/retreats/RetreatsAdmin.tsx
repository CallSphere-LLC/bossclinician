import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Plane } from "lucide-react";
import { adminRetreatsApi, formatRetreatRange, type AdminRetreatSummary } from "@/lib/retreatsApi";
import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from "@/pages/admin/ui/primitives";

/**
 * Admin › Products › Retreats — every FlourisHealer retreat instance.
 *
 * Owner and admin accounts only (the API refuses everyone else). Opening a
 * retreat never changes anything; publishing and granting are separate,
 * deliberate steps.
 */
export default function RetreatsAdmin() {
  const [retreats, setRetreats] = useState<AdminRetreatSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminRetreatsApi
      .list()
      .then((data) => setRetreats(data.retreats))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load retreats."));
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-7 px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow="Products"
        title="FlourisHealer Retreats"
        description="Guests see a retreat's dashboard only when it is published AND they have been given its dashboard product. Nothing here sends email."
      />
      {error && <ErrorNotice message={error} />}
      {retreats === null && !error && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {retreats !== null && retreats.length === 0 && (
        <Card>
          <EmptyState icon={<Plane />} title="No retreats yet" description="Open a retreat and use Duplicate retreat to start a new one." />
        </Card>
      )}
      {retreats !== null && retreats.length > 0 && (
        <div className="grid gap-4">
          {retreats.map((r) => (
            <Link
              key={r.id}
              to={`/admin/retreats/${r.id}`}
              className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              <Card className="p-5 transition-colors hover:border-gold/40">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg text-ink">{r.title}</h2>
                      <Badge tone={r.published ? "green" : "neutral"}>{r.published ? "Published" : "Draft"}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">
                      {formatRetreatRange(r.startDate, r.endDate)} · {r.location}
                    </p>
                  </div>
                  <dl className="flex gap-6 text-sm">
                    <div>
                      <dt className="text-xs text-ink-soft">Guests with dashboard access</dt>
                      <dd className="font-sans text-lg font-bold tabular-nums text-ink">{r.guestCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-soft">Booking holders</dt>
                      <dd className="font-sans text-lg font-bold tabular-nums text-ink">{r.bookingHolderCount}</dd>
                    </div>
                  </dl>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

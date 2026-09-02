import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowUpRight,
  BarChart3,
  Bookmark,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { reportsApi, type ReportCatalogue, type SavedView } from "@/lib/reportsApi";
import { formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Input,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Every number the platform can show her, in one place.
 *
 * Grouped the way she thinks about the business — money, sales, memberships,
 * people — rather than by which table the figures come from. Each card is a
 * sentence: what the report shows and what it will tell her.
 */
export default function ReportsHub() {
  const [catalogue, setCatalogue] = useState<ReportCatalogue | null>(null);
  const [saved, setSaved] = useState<SavedView[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    let cancelled = false;

    reportsApi
      .catalogue()
      .then((data) => !cancelled && setCatalogue(data))
      .catch(() => {
        if (!cancelled) setError("We couldn't load your reports. Try refreshing the page.");
      });

    // Saved views are a convenience; losing them must not blank the list of
    // reports she came here for.
    reportsApi
      .savedViews()
      .then((views) => !cancelled && setSaved(views))
      .catch(() => !cancelled && setSaved([]));

    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    if (!catalogue) return [];
    const needle = search.trim().toLowerCase();
    return catalogue.groups
      .map((group) => ({
        group,
        reports: catalogue.reports.filter(
          (r) =>
            r.group === group &&
            (needle === "" ||
              r.name.toLowerCase().includes(needle) ||
              r.description.toLowerCase().includes(needle)),
        ),
      }))
      .filter((section) => section.reports.length > 0);
  }, [catalogue, search]);

  const total = catalogue?.reports.length ?? 0;
  const showing = grouped.reduce((acc, section) => acc + section.reports.length, 0);

  async function refreshFigures() {
    setRefreshing(true);
    try {
      await reportsApi.refresh();
      toast.success("We're working your figures out again — check back in a minute or two.");
    } catch (err) {
      toast.error(friendlyError(err, "report"));
    } finally {
      setRefreshing(false);
    }
  }

  async function removeView(view: SavedView) {
    const ok = await confirm({
      title: `Delete "${view.name}"?`,
      description: "The report itself stays — this only removes the shortcut you saved.",
      confirmLabel: "Delete it",
      destructive: true,
    });
    if (!ok) return;

    try {
      await reportsApi.deleteView(view.id);
      setSaved((current) => (current ?? []).filter((v) => v.id !== view.id));
      toast.success("Shortcut deleted.");
    } catch (err) {
      toast.error(friendlyError(err, "saved view"));
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Your numbers" />
        <ErrorNotice message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Your numbers"
        description="Everything the platform keeps track of, grouped the way you'd ask for it."
        actions={
          <Button variant="secondary" size="sm" onClick={refreshFigures} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Working them out…" : "Update these figures"}
          </Button>
        }
      />

      {catalogue?.figuresUpdatedAt && (
        <p className="text-xs text-ink-soft">
          Your figures were last worked out {formatRelative(catalogue.figuresUpdatedAt)}. They
          refresh on their own every night.
        </p>
      )}
      {catalogue && catalogue.figuresUpdatedAt === null && (
        <p className="text-xs text-ink-soft">
          Your figures haven't been worked out yet. Press “Update these figures” to do it now, or
          leave it and they'll be ready in the morning.
        </p>
      )}

      {/* Saved shortcuts */}
      {saved && saved.length > 0 && (
        <Card>
          <CardHeader
            title="Your saved views"
            subtitle="Reports you've set up the way you like them"
            icon={<Bookmark className="size-4" />}
          />
          <ul className="divide-y divide-hairline/60">
            {saved.map((view) => (
              <li
                key={view.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/admin/analytics/reports/${view.config.reportId}?view=${view.id}`}
                    className="truncate text-sm font-semibold text-ink hover:underline"
                  >
                    {view.name}
                  </Link>
                  {view.description && (
                    <p className="truncate text-xs text-ink-soft">{view.description}</p>
                  )}
                </div>
                <Badge tone="neutral">
                  {view.config.days
                    ? `Last ${pluralize(view.config.days, "day")}`
                    : "Set dates"}
                </Badge>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Delete the saved view ${view.name}`}
                  onClick={() => void removeView(view)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a report…"
          aria-label="Find a report"
          className="pl-10"
        />
        {search && (
          <p className="mt-1.5 text-xs text-ink-soft">
            Showing {showing} of {total}.
          </p>
        )}
      </div>

      {catalogue === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search />}
            title="Nothing matches that"
            description="Try a different word — or clear the box to see all your reports."
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                Show them all
              </Button>
            }
          />
        </Card>
      ) : (
        grouped.map((section) => (
          <section key={section.group} className="space-y-3">
            <h2 className="flex items-center gap-2 font-display text-lg text-ink">
              <BarChart3 className="size-4 text-gold" />
              {section.group}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {section.reports.map((report) => (
                <Link
                  key={report.id}
                  to={`/admin/analytics/reports/${report.id}`}
                  className="group"
                >
                  <Card className="flex h-full flex-col p-5 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-gold/35">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-base leading-snug text-ink">
                        {report.name}
                      </h3>
                      <ArrowUpRight className="size-4 shrink-0 text-ink-soft transition-colors group-hover:text-gold" />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      {report.description}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      {confirmDialog}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/consoleApi";
import { Card, EmptyState, PageHeader, Skeleton } from "@/pages/admin/ui/primitives";
import { CATEGORY_TONE, useNotifications } from "@/pages/admin/ui/NotificationsMenu";
import { pluralize } from "@/pages/admin/ui/friendly";

/**
 * The dedicated notifications page — Part II §42.
 *
 * Same feed as the header dropdown, with the seven categories as filters. The
 * category is shown as a labelled chip rather than only as a colour, so the
 * filter and the rows agree in words as well as in hue (§51).
 */
export default function Notifications() {
  const notifications = useNotifications(null);
  const [category, setCategory] = useState<NotificationCategory | "all">("all");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of notifications ?? []) {
      map.set(item.category, (map.get(item.category) ?? 0) + 1);
    }
    return map;
  }, [notifications]);

  const visible = useMemo(
    () =>
      category === "all"
        ? (notifications ?? [])
        : (notifications ?? []).filter((n) => n.category === category),
    [notifications, category],
  );

  // Only offer a filter that would actually return something — a row of seven
  // chips, five of them dead ends, is a worse screen than three live ones.
  const available = NOTIFICATION_CATEGORIES.filter((c) => (counts.get(c.key) ?? 0) > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Notifications"
        description="Everything that has happened across your business lately, newest first."
      />

      {notifications === null ? (
        <Card>
          <div className="space-y-2 p-4">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bell />}
            title="Nothing has happened yet"
            description="Sales, failed payments, applications, bookings and moderation reports all appear here as they happen."
          />
        </Card>
      ) : (
        <>
          {available.length > 1 && (
            <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
              <FilterChip
                active={category === "all"}
                onClick={() => setCategory("all")}
                label="All"
                count={notifications.length}
              />
              {available.map((c) => (
                <FilterChip
                  key={c.key}
                  active={category === c.key}
                  onClick={() => setCategory(c.key)}
                  label={c.label}
                  count={counts.get(c.key) ?? 0}
                />
              ))}
            </div>
          )}

          <Card>
            <p className="border-b border-hairline/60 px-5 py-3 text-[0.78rem] text-ink-soft">
              {pluralize(visible.length, "notification", "notifications")}
            </p>
            <ul className="divide-y divide-hairline/60">
              {visible.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-raise"
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.08em]",
                        CATEGORY_TONE[item.category],
                      )}
                    >
                      {item.category}
                    </span>
                    <span className="min-w-[12rem] flex-1">
                      <span className="block text-[0.88rem] font-medium text-ink">{item.title}</span>
                      <span className="block text-[0.78rem] text-ink-soft">{item.detail}</span>
                    </span>
                    <time
                      dateTime={item.at}
                      title={formatDateTime(item.at)}
                      className="shrink-0 font-numeric text-[0.75rem] tabular-nums text-ink-soft"
                    >
                      {formatRelative(item.at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-hairline text-ink-soft hover:border-accent/40 hover:text-ink",
      )}
    >
      {label}
      <span className="ml-1.5 font-numeric tabular-nums opacity-70">{count}</span>
    </button>
  );
}

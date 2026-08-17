import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  FolderOpen,
  GraduationCap,
  MessagesSquare,
  Package,
  Tag,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import type { Community, Plan } from "@/types/admin";
import type { Course } from "@/types";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Badge, Button, Card, ErrorNotice, PageHeader, Skeleton } from "@/pages/admin/ui/primitives";
import { PUBLISH_LABEL, pluralize } from "@/pages/admin/ui/friendly";

/** "a month" / "a year" — how the charge reads in a sentence. */
function everyLabel(interval: string): string {
  if (interval === "month") return "a month";
  if (interval === "year") return "a year";
  if (interval === "week") return "a week";
  return `per ${interval}`;
}

/**
 * "All Products" overview — one place to see everything she sells or gives
 * away, across courses, communities and the plans people pay for monthly.
 */
export default function Products() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.coursesList(), adminApi.communities(), adminApi.plans()])
      .then(([c, comm, p]) => {
        setCourses(c);
        setCommunities(comm);
        setPlans(p);
      })
      .catch(() => setError("We couldn't load what you're selling. Try refreshing the page."));
  }, []);

  const loading = courses === null || communities === null || plans === null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="All Products"
        description="Everything you sell or give away — your courses, your communities and the plans people subscribe to."
      />

      {error && <ErrorNotice message={error} />}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Courses"
          value={courses?.length}
          icon={<GraduationCap className="size-4" />}
          to="/admin/courses"
          loading={loading}
        />
        <SummaryTile
          label="Communities"
          value={communities?.length}
          icon={<MessagesSquare className="size-4" />}
          to="/admin/community"
          loading={loading}
        />
        <SummaryTile
          label="Recurring plans"
          value={plans?.length}
          icon={<Tag className="size-4" />}
          to="/admin/sales/plans"
          loading={loading}
        />
        <SummaryTile
          label="Your files"
          value={undefined}
          icon={<FolderOpen className="size-4" />}
          to="/admin/media"
          loading={false}
          hint="Open"
        />
      </div>

      <Section
        title="Courses"
        to="/admin/courses"
        empty="No courses yet — use Manage to add your first one."
        loading={loading}
        items={(courses ?? []).map((course) => ({
          id: `course-${course.id}`,
          title: course.title,
          subtitle: course.subtitle || "No summary yet",
          meta: course.priceCents
            ? formatCurrency(course.priceCents, course.currency)
            : course.priceText || "No price set",
          published: course.published,
          href: `/admin/courses/${course.id}/curriculum`,
        }))}
      />

      <Section
        title="Communities"
        to="/admin/community"
        empty="No communities yet — use Manage to start one."
        loading={loading}
        items={(communities ?? []).map((community) => ({
          id: `community-${community.id}`,
          title: community.name,
          subtitle: `${pluralize(community.channelCount, "channel")} · ${pluralize(
            community.memberCount,
            "member",
          )}`,
          meta: community.access === "paid" ? "Paid" : "Free to join",
          published: community.published,
          href: `/admin/community/${community.id}`,
        }))}
      />

      <Section
        title="Recurring plans"
        to="/admin/sales/plans"
        empty="No recurring plans yet — use Manage to set one up."
        loading={loading}
        items={(plans ?? []).map((plan) => ({
          id: `plan-${plan.id}`,
          title: plan.name,
          subtitle:
            plan.activeSubscribers === 0
              ? "Nobody paying for this yet"
              : `${pluralize(plan.activeSubscribers, "person", "people")} paying for this`,
          meta: `${formatCurrency(plan.priceCents, plan.currency)} ${everyLabel(plan.interval)}`,
          published: plan.published,
          href: "/admin/sales/plans",
        }))}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon,
  to,
  loading,
  hint,
}: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  to: string;
  loading: boolean;
  hint?: string;
}) {
  return (
    <Link to={to} className="group">
      <Card className="p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-plum/30 group-hover:shadow-[0_18px_40px_-20px_rgba(15,30,58,0.35)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              {label}
            </p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-14" />
            ) : (
              <p className="mt-2 font-display text-[1.65rem] leading-none text-ink">
                {value === undefined ? (hint ?? "Open") : formatNumber(value)}
              </p>
            )}
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lilac-tint text-plum">
            {icon}
          </span>
        </div>
      </Card>
    </Link>
  );
}

interface SectionItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  published: boolean;
  href: string;
}

function Section({
  title,
  to,
  items,
  empty,
  loading,
}: {
  title: string;
  to: string;
  items: SectionItem[];
  empty: string;
  loading: boolean;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-hairline/60 px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display text-base text-ink">
          <Package className="size-4 text-plum" />
          {title}
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link to={to}>
            Manage
            <ArrowUpRight />
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-soft">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {items.map((item, i) => (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.2) }}
            >
              <Link
                to={item.href}
                className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-lilac-tint/25"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{item.title}</p>
                  <p className="truncate text-xs text-ink-soft">{item.subtitle}</p>
                </div>
                <span className="text-sm font-semibold text-plum">{item.meta}</span>
                {!item.published && <Badge tone="slate">{PUBLISH_LABEL.draft}</Badge>}
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </Card>
  );
}

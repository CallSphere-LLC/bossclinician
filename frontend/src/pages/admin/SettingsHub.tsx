import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  BadgeCheck,
  Bell,
  CalendarClock,
  ChevronRight,
  CreditCard,
  Globe,
  GraduationCap,
  Mail,
  Plug,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { settingsApi, type SettingGroup } from "@/lib/settingsApi";
import { Card, ErrorNotice, PageHeader, Skeleton } from "@/pages/admin/ui/primitives";
import { pluralize } from "@/pages/admin/ui/friendly";

/**
 * The front door to settings.
 *
 * A list of places to go, each with a sentence saying what she'd change there.
 * The alternative — one long page of every field the platform has — is the
 * screen people scroll past for two years without ever finding the one box they
 * came for.
 */

const GROUP_ICONS: Record<string, LucideIcon> = {
  general: Bell,
  payments: CreditCard,
  email: Mail,
  members: Users,
  delivery: GraduationCap,
  coaching: CalendarClock,
  marketing: BadgeCheck,
  website: Globe,
  integrations: Plug,
};

interface Destination {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  meta: string;
}

function DestinationCard({ destination, index }: { destination: Destination; index: number }) {
  const Icon = destination.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.28) }}
    >
      <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-gold/35">
        <Link
          to={destination.to}
          className="flex h-full items-start gap-4 rounded-2xl p-5 outline-none focus-visible:ring-4 focus-visible:ring-gold/20"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold/[0.12] text-gold">
            <Icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-display text-base text-ink">{destination.label}</span>
              <ChevronRight className="size-4 shrink-0 text-ink-soft/60" />
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-ink-soft">
              {destination.description}
            </span>
            <span className="mt-2 block text-xs text-ink-soft/70">{destination.meta}</span>
          </span>
        </Link>
      </Card>
    </motion.div>
  );
}

export default function SettingsHub() {
  const [groups, setGroups] = useState<SettingGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .groups()
      .then((res) => {
        setGroups(res.groups);
        setError(null);
      })
      .catch(() => setError("We couldn't load your settings. Try refreshing the page."));
  }, []);

  const settingDestinations: Destination[] = (groups ?? []).map((group) => ({
    to: `/admin/settings/${group.key}`,
    label: group.label,
    description: group.description,
    icon: GROUP_ICONS[group.key] ?? Bell,
    meta: pluralize(group.settings.length, "thing to change", "things to change"),
  }));

  const peopleDestinations: Destination[] = [
    {
      to: "/admin/settings/team",
      label: "Who can get in",
      description:
        "The people who can sign in to this admin, what each of them can do, and how you keep your own account safe.",
      icon: ShieldCheck,
      meta: "Your team and your sign-in security",
    },
    {
      to: "/admin/settings/connections",
      label: "Connections",
      description:
        "Send what happens here to another tool, and give a tool permission to read from you.",
      icon: Plug,
      meta: "Zapier and anything else you plug in",
    },
  ];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Everything about how your business runs, in one place. Pick what you'd like to change."
      />

      {error && <ErrorNotice message={error} />}

      <section className="space-y-3">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-gold/85">
          Your business
        </h2>
        {groups === null ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {settingDestinations.map((destination, i) => (
              <DestinationCard key={destination.to} destination={destination} index={i} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-gold/85">
          People and other tools
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {peopleDestinations.map((destination, i) => (
            <DestinationCard key={destination.to} destination={destination} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

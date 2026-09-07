import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  Mail,
  Package,
  Plus,
  Sparkles,
  Ticket,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

/**
 * Quick Create — Part II §10 and §31.
 *
 * The same six tasks §31 lists on the dashboard, reachable from every screen.
 * §31's phrasing is that "common daily tasks should remain extremely easy to
 * access", which a dashboard-only panel is not once she has navigated away.
 */

const ACTIONS: { to: string; label: string; hint: string; Icon: LucideIcon }[] = [
  { to: "/admin/contacts", label: "Add contact", hint: "Someone new to keep in touch with", Icon: UserPlus },
  { to: "/admin/offers/new", label: "Create offer", hint: "Something to sell, with a price", Icon: Ticket },
  { to: "/admin/products", label: "Create product", hint: "Something a customer receives", Icon: Package },
  { to: "/admin/marketing/campaigns", label: "Send email", hint: "A one-off email to a group", Icon: Mail },
  { to: "/admin/marketing/automations-v2", label: "Create automation", hint: "When this happens, do that", Icon: Sparkles },
  { to: "/admin/marketing/events-v2", label: "Schedule event", hint: "A live class or webinar", Icon: CalendarDays },
];

export function QuickCreate() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent-solid px-3 text-[0.8rem] font-semibold text-accent-on transition-all hover:brightness-110"
        >
          <Plus aria-hidden className="size-4" />
          <span className="hidden sm:inline">Create</span>
          <span className="sr-only sm:hidden">Create something new</span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[16rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-console-pop"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-ink-soft">
            Create
          </DropdownMenu.Label>
          {ACTIONS.map((action) => (
            <DropdownMenu.Item key={action.to} asChild>
              <Link
                to={action.to}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-raise"
              >
                <action.Icon aria-hidden className="size-4 shrink-0 text-ink-soft" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{action.label}</span>
                  <span className="block truncate text-[0.7rem] text-ink-soft">{action.hint}</span>
                </span>
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Compass, LayoutDashboard } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/pages/admin/ui/primitives";
import { resolveAdminAlias } from "@/pages/admin/adminAliases";
import { NAV_GROUPS } from "@/pages/admin/ui/nav";

/**
 * Follows an alias first, and renders `children` only if there is none.
 *
 * For the dynamic routes that would otherwise swallow an aliased path before
 * the catch-all ever sees it: `/settings/:group` reads `/settings/users` as a
 * group called "users", `/contacts/:id` reads `/contacts/tags` as a contact.
 * Query and hash come along, as they do from the 404.
 */
export function AliasFirst({ children }: { children: ReactNode }) {
  const location = useLocation();
  const alias = resolveAdminAlias(location.pathname);
  if (alias) {
    return <Navigate to={`${alias}${location.search}${location.hash}`} replace />;
  }
  return <>{children}</>;
}

/**
 * What an admin URL that matches nothing gets.
 *
 * This route used to be `<Navigate to="/admin" replace />`: every mistyped,
 * bookmarked or shared admin link silently became the dashboard. That reads as
 * "the page you wanted has moved and we won't say where" — the visitor has no
 * way to tell a bad address from a broken one, and the address bar no longer
 * holds the URL they were investigating. Two honest answers instead: a real
 * redirect where we know where the path went (`adminAliases`), and this page
 * where we do not.
 */
export default function AdminNotFound() {
  // A path we recognise from an older layout goes to its current home, keeping
  // the query and hash so a filtered or anchored bookmark survives too.
  return (
    <AliasFirst>
      <NotFoundPage />
    </AliasFirst>
  );
}

function NotFoundPage() {
  const location = useLocation();
  const suggestions = suggestionsFor(location.pathname);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Not found"
        title="That admin page doesn't exist"
        description="The address is wrong rather than the page being broken — nothing has been deleted, and everything in the sidebar still works."
      />

      <Card>
        <EmptyState
          icon={<Compass />}
          title="No screen lives at this address"
          description="Check the spelling, or pick it out of the menu on the left."
          action={
            <Button asChild>
              <Link to="/admin">
                <LayoutDashboard />
                Back to the dashboard
              </Link>
            </Button>
          }
        />
        <p className="border-t border-hairline/60 px-5 py-4 text-center text-xs text-ink-soft">
          You asked for <span className="break-all font-mono text-ink">{location.pathname}</span>
        </p>
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <div className="px-5 py-5">
            <p className="text-sm font-semibold text-ink">Did you mean one of these?</p>
            <ul className="mt-3 space-y-1.5">
              {suggestions.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="text-sm text-gold underline-offset-4 hover:underline"
                  >
                    {item.group} → {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Sidebar entries whose address or label echoes what was typed.
 *
 * Deliberately dumb — a substring match on the last segment. It catches the
 * near-misses the alias table does not enumerate (`/admin/course`,
 * `/admin/settings/team-members`) and offers nothing at all when it has
 * nothing, rather than guessing.
 */
function suggestionsFor(pathname: string): { to: string; label: string; group: string }[] {
  const segment = pathname.replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
  if (segment.length < 3) return [];

  // A sidebar group's own name — /admin/sales, /admin/marketing, /admin/website
  // — has no screen of its own, so offer everything in that group.
  for (const group of NAV_GROUPS) {
    if (group.children && (group.id === segment || group.label.toLowerCase() === segment)) {
      return group.children.map((child) => ({ to: child.to, label: child.label, group: group.label }));
    }
  }

  const hits: { to: string; label: string; group: string }[] = [];
  for (const group of NAV_GROUPS) {
    for (const child of group.children ?? []) {
      const slug = child.to.split("/").pop()?.toLowerCase() ?? "";
      const label = child.label.toLowerCase();
      if (slug.includes(segment) || (slug.length >= 3 && segment.includes(slug)) || label.includes(segment)) {
        hits.push({ to: child.to, label: child.label, group: group.label });
      }
    }
  }
  return hits.slice(0, 4);
}

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Mail } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Subscriber } from "@/types";
import { formatDate } from "@/lib/format";
import { Badge, Button, EmptyState, ErrorNotice, PageHeader } from "@/pages/admin/ui/primitives";
import { humaniseKey, pluralize } from "@/pages/admin/ui/friendly";
import { DataTable } from "@/pages/admin/ui/DataTable";

/**
 * Every sign-up box on the public site, named the way she'd point at it. The
 * stored value is the short tag the box sends along ("footer"); she only ever
 * sees the page it sits on.
 */
const SOURCE_LABEL: Record<string, string> = {
  footer: "Website footer",
  resources: "Free resources page",
  "practice-reset-planner": "Practice Reset Planner page",
  masterclass: "Free masterclass",
  newsletter: "Newsletter sign-up",
  automation: "Added automatically",
  admin: "Added by you",
  import: "Imported list",
};

/** Anything we don't have a name for still reads as words, never as a tag. */
function sourceLabel(source: string): string {
  const tag = source?.trim();
  if (!tag) return "Somewhere on your site";
  return SOURCE_LABEL[tag] ?? humaniseKey(tag);
}

export default function Subscribers() {
  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .subscribersList()
      .then(setSubscribers)
      .catch(() => setError("We couldn't load your subscribers. Try refreshing the page."));
  }, []);

  const columns = useMemo<ColumnDef<Subscriber, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Email address",
        cell: ({ row }) => (
          <a
            href={`mailto:${row.original.email}`}
            className="font-medium text-ink hover:text-accent hover:underline"
          >
            {row.original.email}
          </a>
        ),
      },
      {
        id: "source",
        // The friendly label rather than the stored tag, so sorting and the
        // search box both work on the words she can actually see.
        accessorFn: (subscriber) => sourceLabel(subscriber.source),
        header: "Signed up on",
        cell: ({ row }) => <Badge tone="neutral">{sourceLabel(row.original.source)}</Badge>,
      },
      {
        accessorKey: "createdAt",
        header: "Joined your list",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    [],
  );

  /**
   * Built in the browser rather than asked of the server — a list this size
   * doesn't need a round trip. The file opens straight into Excel, Numbers or
   * Google Sheets, which is the only thing she needs to know about it.
   */
  function downloadSpreadsheet() {
    if (!subscribers?.length) return;
    const header = "Email address,Signed up on,Joined your list\n";
    const rows = subscribers
      // Quote every field: the sign-up labels are free text and could contain commas.
      .map((s) => `"${s.email}","${sourceLabel(s.source)}","${formatDate(s.createdAt)}"`)
      .join("\n");

    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${pluralize(subscribers.length, "subscriber")}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="Subscribers"
        description="People who have agreed to receive your marketing email."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={downloadSpreadsheet}
            disabled={!subscribers?.length}
          >
            <Download />
            Download as spreadsheet
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={subscribers}
        searchPlaceholder="Search your subscribers…"
        itemNoun={{ one: "subscriber", many: "subscribers" }}
        emptyState={
          <EmptyState
            icon={<Mail />}
            title="No subscribers yet"
            description="When someone signs up through your website footer, a resource page or the free masterclass, they'll appear here."
          />
        }
      />
    </div>
  );
}

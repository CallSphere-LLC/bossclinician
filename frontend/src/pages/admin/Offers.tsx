import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  Copy,
  Eye,
  EyeOff,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import {
  adminCommerceApi,
  commerceMessage,
  OFFER_STATUS_LABEL,
  priceSummary,
  type CatalogStatus,
  type Offer,
} from "@/lib/adminCommerceApi";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  PageHeader,
  selectStyles,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { StripeBanner } from "@/pages/admin/ui/StripeBanner";
import { pluralize, shareLink, webAddress } from "@/pages/admin/ui/friendly";

/**
 * The offers list — every price she sells at, and how each one is doing.
 *
 * One product can sit behind any number of offers, so this list is longer than
 * the catalogue and is the screen she actually lives in: what is live, what a
 * customer pays, and how many people have bought it.
 */

const STATUS_TONE: Record<CatalogStatus, NonNullable<BadgeProps["tone"]>> = {
  published: "green",
  draft: "slate",
  archived: "neutral",
};

/** Matches the Input primitive so the filter row reads as one set of controls. */
const STATUS_FILTERS: { value: "" | CatalogStatus; label: string }[] = [
  { value: "", label: "All offers" },
  { value: "published", label: "Live ones" },
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
];

/** "The Full Practice Reset + 2 more" — what the offer hands over, in one line. */
function sellsLine(offer: Offer): string {
  const titles = offer.products.map((product) => product.title);
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0];
  return `${titles[0]} + ${titles.length - 1} more`;
}

function MenuItem({
  icon,
  children,
  onSelect,
  destructive,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none [&_svg]:size-4",
        destructive
          ? "text-red-400 data-[highlighted]:bg-red-500/10"
          : "text-ink data-[highlighted]:bg-raise [&_svg]:text-ink-soft",
      )}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}

export default function Offers() {
  const navigate = useNavigate();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | CatalogStatus>("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminCommerceApi
      .offerList()
      .then((list) => {
        setOffers(list);
        setError(null);
      })
      .catch(() => setError("We couldn't load your offers. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    if (offers === null) return null;
    return statusFilter ? offers.filter((offer) => offer.status === statusFilter) : offers;
  }, [offers, statusFilter]);

  async function copyCheckoutLink(offer: Offer) {
    try {
      await navigator.clipboard.writeText(shareLink("checkout", offer.slug));
      toast.success("Checkout link copied — paste it into an email or a post.");
    } catch {
      toast.error("Your browser wouldn't let us copy that. Please try again.");
    }
  }

  async function run(offer: Offer, work: () => Promise<unknown>, done: string) {
    setBusyId(offer.id);
    try {
      await work();
      toast.success(done);
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    } finally {
      setBusyId(null);
    }
  }

  function publish(offer: Offer) {
    void run(
      offer,
      () => adminCommerceApi.offerPublish(offer.id),
      `“${offer.title}” is live — anyone with the link can buy it.`,
    );
  }

  function unpublish(offer: Offer) {
    void run(
      offer,
      () => adminCommerceApi.offerUpdate(offer.id, { status: "draft" }),
      `“${offer.title}” is back to a draft. Nobody can buy it now.`,
    );
  }

  async function duplicate(offer: Offer) {
    setBusyId(offer.id);
    try {
      const copy = await adminCommerceApi.offerDuplicate(offer.id);
      toast.success("Copied. Change the price and the name, then put it live.");
      navigate(`/admin/offers/${copy.id}`);
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    } finally {
      setBusyId(null);
    }
  }

  async function archive(offer: Offer) {
    const ok = await confirm({
      title: `Archive “${offer.title}”?`,
      description:
        offer.purchaseCount > 0
          ? "It stops selling straight away. Everyone who already bought it keeps what they paid for, and it stays in your sales history."
          : "It stops selling straight away and moves out of your way. You can bring it back as a draft later.",
      confirmLabel: "Yes, archive it",
    });
    if (!ok) return;
    void run(offer, () => adminCommerceApi.offerArchive(offer.id), `“${offer.title}” is archived.`);
  }

  function restore(offer: Offer) {
    void run(
      offer,
      () => adminCommerceApi.offerUpdate(offer.id, { status: "draft" }),
      `“${offer.title}” is back as a draft.`,
    );
  }

  const columns = useMemo<ColumnDef<Offer, unknown>[]>(
    () => [
      {
        id: "title",
        accessorFn: (offer) => `${offer.title} ${sellsLine(offer)}`,
        header: "Offer",
        cell: ({ row }) => {
          const offer = row.original;
          const sells = sellsLine(offer);
          return (
            <div className="min-w-0">
              <Link
                to={`/admin/offers/${offer.id}`}
                className="font-semibold text-ink transition-colors hover:text-gold"
              >
                {offer.title}
              </Link>
              <p className="mt-0.5 truncate text-xs text-ink-soft">
                {sells ? (
                  <>Sells {sells}</>
                ) : (
                  <span className="text-gold">
                    Nothing attached yet — add what they get before it can go live
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[0.7rem] text-ink-soft/70">
                {webAddress("checkout", offer.slug)}
              </p>
            </div>
          );
        },
      },
      {
        id: "price",
        accessorFn: (offer) => offer.amountCents,
        header: "What they pay",
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-semibold text-plum">
            {priceSummary(row.original)}
          </span>
        ),
      },
      {
        id: "status",
        // Sorted on the words on the badge, not the state behind them.
        accessorFn: (offer) => OFFER_STATUS_LABEL[offer.status],
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status]}>
            {OFFER_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: "purchaseCount",
        header: "Bought by",
        cell: ({ row }) =>
          row.original.purchaseCount > 0 ? (
            <span className="whitespace-nowrap tabular-nums text-ink">
              {pluralize(row.original.purchaseCount, "person", "people")}
            </span>
          ) : (
            <span className="text-sm text-ink-soft">Nobody yet</span>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const offer = row.original;
          const live = offer.status === "published";
          return (
            <RowActions>
              <Button asChild variant="ghost" size="sm">
                <Link to={`/admin/offers/${offer.id}`}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    disabled={busyId === offer.id}
                    aria-label={`More you can do with ${offer.title}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="z-50 min-w-[16rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
                  >
                    <MenuItem icon={<Link2 />} onSelect={() => void copyCheckoutLink(offer)}>
                      Copy the checkout link
                    </MenuItem>
                    {offer.status === "archived" ? (
                      <MenuItem icon={<Eye />} onSelect={() => restore(offer)}>
                        Bring it back as a draft
                      </MenuItem>
                    ) : live ? (
                      <MenuItem icon={<EyeOff />} onSelect={() => unpublish(offer)}>
                        Stop selling it
                      </MenuItem>
                    ) : (
                      <MenuItem icon={<Eye />} onSelect={() => publish(offer)}>
                        Put it live
                      </MenuItem>
                    )}
                    <MenuItem icon={<Copy />} onSelect={() => void duplicate(offer)}>
                      Make a copy
                    </MenuItem>
                    {offer.status !== "archived" && (
                      <>
                        <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
                        <MenuItem icon={<Archive />} onSelect={() => void archive(offer)}>
                          Archive it
                        </MenuItem>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </RowActions>
          );
        },
      },
    ],
    // The row menu closes over the handlers, which are stable for the life of
    // the screen; only the busy row id changes what the table needs to render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId],
  );

  const liveCount = (offers ?? []).filter((offer) => offer.status === "published").length;
  const soldTotal = (offers ?? []).reduce((sum, offer) => sum + offer.purchaseCount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Main"
        title="Offers"
        description="Create and manage what customers can buy, including pricing and purchase options."
        actions={
          <Button asChild size="sm">
            <Link to="/admin/offers/new">
              <Plus />
              Create an offer
            </Link>
          </Button>
        }
      />

      <StripeBanner />

      {error && <ErrorNotice message={error} />}

      {offers !== null && offers.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <SummaryTile label="Offers in total" value={formatNumber(offers.length)} />
          <SummaryTile label="Live right now" value={formatNumber(liveCount)} />
          <SummaryTile
            label="Sales so far"
            value={soldTotal > 0 ? formatNumber(soldTotal) : "None yet"}
          />
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Search your offers"
        itemNoun={{ one: "offer", many: "offers" }}
        minWidth="880px"
        toolbar={
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | CatalogStatus)}
            aria-label="Which offers to show"
            className={selectStyles}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        }
        emptyState={
          statusFilter ? (
            <EmptyState
              icon={<Tag />}
              title="Nothing here yet"
              description="No offers of that sort. Show all of them to see the rest."
              action={
                <Button variant="secondary" size="sm" onClick={() => setStatusFilter("")}>
                  Show all offers
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Tag />}
              title="Let's put your first thing up for sale"
              description="An offer is a price and a checkout page for something you've already made — pick what they get, say what it costs, and you have a link you can share."
              action={
                <Button asChild size="sm">
                  <Link to="/admin/offers/new">
                    <Plus />
                    Create your first offer
                  </Link>
                </Button>
              }
            />
          )
        }
      />

      {confirmDialog}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[9rem] flex-1 rounded-2xl border border-hairline bg-surface px-4 py-3">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {label}
      </p>
      <p className="mt-1 font-display text-xl leading-none text-ink">{value}</p>
    </div>
  );
}

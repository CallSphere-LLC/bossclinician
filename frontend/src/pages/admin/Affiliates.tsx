import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Check,
  Download,
  Handshake,
  Image as ImageIcon,
  Megaphone,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import {
  adminAffiliateApi,
  type AdminPartner,
  type PayoutDue,
  type ProgramSettings,
} from "@/lib/affiliateApi";

/**
 * Partners — the owner's whole view of the program in one screen.
 *
 * The vocabulary is the constraint that shapes everything here. She never sees
 * "affiliate", "basis points", "attribution model", a status enum or a row id;
 * she sees people, what they earned, and a button that says what it does. Where
 * a machine word is unavoidable in the data, the server sends the English
 * alongside it and this file renders that rather than inventing its own.
 */

type Tab = "partners" | "payments" | "creative" | "news" | "howitworks";

const TABS: { id: Tab; label: string }[] = [
  { id: "partners", label: "Your partners" },
  { id: "payments", label: "Paying them" },
  { id: "creative", label: "Things they can use" },
  { id: "news", label: "News for partners" },
  { id: "howitworks", label: "How it works" },
];

/** The lifecycle in her words. The stored values are one-word machine states. */
const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting on you",
  approved: "Active",
  suspended: "On hold",
  rejected: "Turned down",
};

const STATUS_TONE: Record<string, "blue" | "green" | "gold" | "slate"> = {
  pending: "blue",
  approved: "green",
  suspended: "gold",
  rejected: "slate",
};

function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-hairline/60 pb-3">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? "page" : undefined}
          className={
            active === tab.id
              ? "rounded-xl bg-gold/[0.14] px-4 py-2 text-sm font-semibold text-gold"
              : "rounded-xl px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-white/[0.05] hover:text-ink"
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- partners */

function PartnersTab({ onError }: { onError: (message: string) => void }) {
  const [partners, setPartners] = useState<AdminPartner[] | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminAffiliateApi
      .list()
      .then((page) => setPartners(page.partners))
      .catch(() => onError("We couldn't load your partners. Try refreshing the page."));
  }, [onError]);

  useEffect(load, [load]);

  const approve = useCallback(
    async (partner: AdminPartner) => {
      try {
        await adminAffiliateApi.approve(partner.id);
        toast.success(`${partner.name} is now a partner`);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "partner"));
      }
    },
    [load],
  );

  const decline = useCallback(
    async (partner: AdminPartner) => {
      const ok = await confirm({
        title: `Turn down ${partner.name}?`,
        description:
          "They won't be able to earn on anything from now on. Anything they've already earned stays on their account.",
        confirmLabel: "Yes, turn them down",
        destructive: true,
      });
      if (!ok) return;
      try {
        await adminAffiliateApi.reject(partner.id, { suspend: partner.status === "approved" });
        toast.success("Done");
        load();
      } catch (err) {
        toast.error(friendlyError(err, "partner"));
      }
    },
    [confirm, load],
  );

  const columns = useMemo<ColumnDef<AdminPartner, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Partner",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/admin/partners/${row.original.id}`}
              className="font-medium text-ink hover:text-plum hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="truncate text-xs text-ink-soft">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (partner) => STATUS_LABEL[partner.status] ?? partner.status,
        header: "Where they're up to",
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status] ?? "neutral"}>
            {STATUS_LABEL[row.original.status] ?? row.original.status}
          </Badge>
        ),
      },
      {
        id: "commission",
        accessorFn: (partner) => partner.commission.label,
        header: "They earn",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink">
            {row.original.commission.label}
          </span>
        ),
      },
      {
        accessorKey: "sales",
        header: "Sales sent",
        cell: ({ row }) => <span className="tabular-nums text-sm">{row.original.sales}</span>,
      },
      {
        accessorKey: "earnedCents",
        header: "Earned",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-sm font-medium text-ink">
            {formatCurrency(row.original.earnedCents)}
          </span>
        ),
      },
      {
        accessorKey: "owedCents",
        header: "Still owed",
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-sm text-ink-soft">
            {formatCurrency(row.original.owedCents)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            {row.original.status === "pending" && (
              <Button size="sm" onClick={() => void approve(row.original)}>
                <Check />
                Approve
              </Button>
            )}
            {row.original.status !== "rejected" && (
              <Button
                variant="dangerGhost"
                size="iconSm"
                aria-label={`Turn down ${row.original.name}`}
                onClick={() => void decline(row.original)}
              >
                <X />
              </Button>
            )}
          </RowActions>
        ),
      },
    ],
    [approve, decline],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={partners}
        searchPlaceholder="Search your partners…"
        itemNoun={{ one: "partner", many: "partners" }}
        minWidth="880px"
        emptyState={
          <EmptyState
            icon={<Handshake />}
            title="No partners yet"
            description="When someone applies through your partner page, they'll appear here waiting for your yes."
          />
        }
      />
      {confirmDialog}
    </>
  );
}

/* ------------------------------------------------------------- payments */

function PaymentsTab({ onError }: { onError: (message: string) => void }) {
  const [due, setDue] = useState<PayoutDue[] | null>(null);
  const [totalCents, setTotalCents] = useState(0);
  const [history, setHistory] = useState<
    { id: number; name: string; amountCents: number; status: string; paidAt: string | null }[]
  >([]);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    adminAffiliateApi
      .payoutsDue()
      .then((page) => {
        setDue(page.due);
        setTotalCents(page.totalCents);
      })
      .catch(() => onError("We couldn't work out what you owe. Try refreshing the page."));

    adminAffiliateApi
      .payouts()
      .then((page) =>
        setHistory(
          page.payouts.map((payout) => ({
            id: payout.id,
            name: payout.name,
            amountCents: payout.amountCents,
            status: payout.status,
            paidAt: payout.paidAt,
          })),
        ),
      )
      .catch(() => undefined);
  }, [onError]);

  useEffect(load, [load]);

  async function preparePayment(row: PayoutDue) {
    setBusy(row.affiliateId);
    try {
      await adminAffiliateApi.createPayout({ affiliateId: row.affiliateId });
      toast.success(`Payment to ${row.name} prepared`);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "payment"));
    } finally {
      setBusy(null);
    }
  }

  async function markSent(id: number) {
    try {
      await adminAffiliateApi.markPayoutPaid(id);
      toast.success("Marked as sent");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "payment"));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<Wallet />}
          title="Ready to be paid"
          subtitle={
            due === null
              ? undefined
              : `${formatCurrency(totalCents)} across ${pluralize(due.length, "partner", "partners")}`
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void adminAffiliateApi
                  .exportPayments()
                  .catch(() => toast.error("We couldn't build that file just now."))
              }
            >
              <Download />
              Download the list
            </Button>
          }
        />

        {due === null ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : due.length === 0 ? (
          <EmptyState
            icon={<Wallet />}
            title="Nobody's waiting on a payment"
            description="Money earned in the last few weeks is still inside the refund window. It appears here once it's cleared."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {due.map((row) => (
              <li key={row.affiliateId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{row.name}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {row.payoutMethod || "No payment method on file"}
                    {row.payoutDetails ? ` · ${row.payoutDetails}` : ""}
                  </p>
                </div>
                <span className="whitespace-nowrap font-display text-lg text-plum">
                  {formatCurrency(row.amountCents, row.currency)}
                </span>
                <Button
                  size="sm"
                  disabled={busy === row.affiliateId}
                  onClick={() => void preparePayment(row)}
                >
                  {busy === row.affiliateId ? "Preparing…" : "Prepare payment"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Payments you've made" />
        {history.length === 0 ? (
          <EmptyState
            icon={<Wallet />}
            title="No payments yet"
            description="Once you prepare a payment it appears here, so you can mark it off when the money's actually gone."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {history.map((payout) => (
              <li key={payout.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{payout.name}</p>
                  <p className="text-xs text-ink-soft">
                    {payout.paidAt ? `Sent ${formatDate(payout.paidAt)}` : "Not sent yet"}
                  </p>
                </div>
                <span className="whitespace-nowrap tabular-nums text-sm text-ink">
                  {formatCurrency(payout.amountCents)}
                </span>
                {payout.status === "paid" ? (
                  <Badge tone="green">Sent</Badge>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void markSent(payout.id)}>
                    I've sent this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- creative */

interface AssetDraft {
  id?: number;
  title: string;
  kind: string;
  url: string;
  bodyMd: string;
  sort: number;
}

const KIND_LABEL: Record<string, string> = {
  image: "A picture",
  swipe: "Wording they can copy",
  video: "A video",
  document: "A document",
};

const EMPTY_ASSET: AssetDraft = { title: "", kind: "image", url: "", bodyMd: "", sort: 0 };

function CreativeTab({ onError }: { onError: (message: string) => void }) {
  const [assets, setAssets] = useState<
    { id: number; title: string; kind: string; url: string; bodyMd: string; sort: number }[] | null
  >(null);
  const [editing, setEditing] = useState<AssetDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminAffiliateApi
      .assets()
      .then((page) => setAssets(page.assets))
      .catch(() => onError("We couldn't load these. Try refreshing the page."));
  }, [onError]);

  useEffect(load, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing?.title.trim()) return;
    setSaving(true);
    try {
      if (editing.id) {
        await adminAffiliateApi.updateAsset(editing.id, {
          title: editing.title,
          kind: editing.kind,
          url: editing.url,
          bodyMd: editing.bodyMd,
          sort: editing.sort,
        });
      } else {
        await adminAffiliateApi.createAsset({
          title: editing.title,
          kind: editing.kind,
          url: editing.url,
          bodyMd: editing.bodyMd,
          offerId: null,
          sort: editing.sort,
        });
      }
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "item"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number, title: string) {
    const ok = await confirm({
      title: `Delete “${title}”?`,
      description: "Your partners won't see it any more.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminAffiliateApi.deleteAsset(id);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "item"));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<ImageIcon />}
          title="Things partners can use"
          subtitle="Pictures, wording and anything else worth handing them."
          action={
            <Button size="sm" onClick={() => setEditing({ ...EMPTY_ASSET })}>
              <Plus />
              Add something
            </Button>
          }
        />

        {assets === null ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title="Nothing here yet"
            description="Add a picture or some wording your partners can drop straight into a post."
            action={
              <Button size="sm" onClick={() => setEditing({ ...EMPTY_ASSET })}>
                Add something
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {assets.map((asset) => (
              <li key={asset.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{asset.title}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {KIND_LABEL[asset.kind] ?? asset.kind}
                    {asset.url ? ` · ${asset.url}` : ""}
                  </p>
                </div>
                <RowActions>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(asset)}>
                    Edit
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Delete ${asset.title}`}
                    onClick={() => void remove(asset.id, asset.title)}
                  >
                    <Trash2 />
                  </Button>
                </RowActions>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "Edit this" : "Add something for your partners"}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="asset-form" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="asset-form" onSubmit={save} className="grid gap-4">
            <Field label="What is it?">
              <Input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="Instagram square — spring launch"
                required
                autoFocus
              />
            </Field>
            <Field label="Kind">
              <select
                value={editing.kind}
                onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                className={selectStyles}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Link to the file" hint="leave blank if it's just wording">
              <Input
                value={editing.url}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                placeholder="https://…"
              />
            </Field>
            <Field label="The wording" hint="what they can copy and paste">
              <Textarea
                rows={5}
                value={editing.bodyMd}
                onChange={(e) => setEditing({ ...editing, bodyMd: e.target.value })}
              />
            </Field>
            <Field label="Order" hint="lower numbers show first">
              <Input
                type="number"
                value={editing.sort}
                onChange={(e) => setEditing({ ...editing, sort: Number(e.target.value) || 0 })}
              />
            </Field>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

/* ----------------------------------------------------------------- news */

interface NewsDraft {
  id?: number;
  title: string;
  bodyMd: string;
  published: boolean;
}

const EMPTY_NEWS: NewsDraft = { title: "", bodyMd: "", published: true };

function NewsTab({ onError }: { onError: (message: string) => void }) {
  const [items, setItems] = useState<
    { id: number; title: string; bodyMd: string; published: boolean; createdAt: string }[] | null
  >(null);
  const [editing, setEditing] = useState<NewsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminAffiliateApi
      .announcements()
      .then((page) => setItems(page.announcements))
      .catch(() => onError("We couldn't load your news. Try refreshing the page."));
  }, [onError]);

  useEffect(load, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing?.title.trim()) return;
    setSaving(true);
    try {
      if (editing.id) {
        await adminAffiliateApi.updateAnnouncement(editing.id, {
          title: editing.title,
          bodyMd: editing.bodyMd,
          published: editing.published,
        });
      } else {
        await adminAffiliateApi.createAnnouncement({
          title: editing.title,
          bodyMd: editing.bodyMd,
          published: editing.published,
        });
      }
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number, title: string) {
    const ok = await confirm({
      title: `Delete “${title}”?`,
      description: "Your partners won't see it any more.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminAffiliateApi.deleteAnnouncement(id);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "post"));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          icon={<Megaphone />}
          title="News for partners"
          subtitle="Shown at the top of their dashboard."
          action={
            <Button size="sm" onClick={() => setEditing({ ...EMPTY_NEWS })}>
              <Plus />
              Write something
            </Button>
          }
        />

        {items === null ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Megaphone />}
            title="Nothing announced yet"
            description="Tell your partners about a launch, a new rate, or a change to the terms."
            action={
              <Button size="sm" onClick={() => setEditing({ ...EMPTY_NEWS })}>
                Write something
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                  <p className="text-xs text-ink-soft">{formatDate(item.createdAt)}</p>
                </div>
                <Badge tone={item.published ? "green" : "slate"}>
                  {item.published ? "Partners can see this" : "Not visible yet"}
                </Badge>
                <RowActions>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(item)}>
                    Edit
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => void remove(item.id, item.title)}
                  >
                    <Trash2 />
                  </Button>
                </RowActions>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.id ? "Edit this post" : "Write to your partners"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="news-form" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="news-form" onSubmit={save} className="grid gap-4">
            <Field label="Headline">
              <Input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="New rate on the spring retreat"
                required
                autoFocus
              />
            </Field>
            <Field label="What you want to say">
              <Textarea
                rows={8}
                value={editing.bodyMd}
                onChange={(e) => setEditing({ ...editing, bodyMd: e.target.value })}
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={editing.published}
                onChange={(e) => setEditing({ ...editing, published: e.target.checked })}
                className="size-4 rounded border-hairline text-plum"
              />
              Show this to your partners
            </label>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

/* ----------------------------------------------------------- how it works */

/** Stored pennies → what she typed: 5000 → "50", 5050 → "50.50". */
function centsToInput(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function HowItWorksTab({ onError }: { onError: (message: string) => void }) {
  const [settings, setSettings] = useState<ProgramSettings | null>(null);
  const [saving, setSaving] = useState(false);
  /* Both numbers are held as the text she is typing. Re-formatting a money box
     on every keystroke turned "50" into "5.00" after the first digit and put
     the second one after the decimal point — there was no way to type a fixed
     commission of $50, or a share of 30.5%. */
  const [percentText, setPercentText] = useState("");
  const [amountText, setAmountText] = useState("");

  useEffect(() => {
    adminAffiliateApi
      .settings()
      .then((loaded) => {
        setSettings(loaded);
        setPercentText(String(loaded.commissionPercent));
        setAmountText(centsToInput(loaded.commissionAmountCents));
      })
      .catch(() => onError("We couldn't load your program settings. Try refreshing the page."));
  }, [onError]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await adminAffiliateApi.saveSettings({
        ...settings,
        commissionPercent: Number(percentText) || 0,
        commissionAmountCents: Math.round((Number(amountText) || 0) * 100),
      });
      setSettings(saved);
      setPercentText(String(saved.commissionPercent));
      setAmountText(centsToInput(saved.commissionAmountCents));
      toast.success("Saved");
    } catch (err) {
      toast.error(friendlyError(err, "setting"));
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <Skeleton className="h-96 w-full" />;

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader title="What partners earn" subtitle="Unless you set something different for one of them." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="How they're paid">
            <select
              value={settings.commissionKind}
              onChange={(e) =>
                setSettings({ ...settings, commissionKind: e.target.value as "percent" | "fixed" })
              }
              className={selectStyles}
            >
              <option value="percent">A share of each sale</option>
              <option value="fixed">A fixed amount per sale</option>
            </select>
          </Field>

          {settings.commissionKind === "percent" ? (
            <Field label="Their share" hint="of what the customer pays">
              <div className="relative">
                <Input
                  inputMode="decimal"
                  value={percentText}
                  onChange={(e) => setPercentText(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="pr-8"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
                >
                  %
                </span>
              </div>
            </Field>
          ) : (
            <Field label="Amount per sale">
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
                >
                  $
                </span>
                <Input
                  className="pl-8"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ""))}
                />
              </div>
            </Field>
          )}

          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink sm:col-span-2">
            <input
              type="checkbox"
              checked={settings.payOnEveryRenewal}
              onChange={(e) => setSettings({ ...settings, payOnEveryRenewal: e.target.checked })}
              className="size-4 rounded border-hairline text-plum"
            />
            Pay them again every time a subscription renews
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="Who gets the credit" subtitle="When somebody clicks two different partners' links before buying." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Credit goes to">
            <select
              value={settings.whoGetsCredit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  whoGetsCredit: e.target.value as "last_click" | "first_click",
                })
              }
              className={selectStyles}
            >
              <option value="last_click">The last link they clicked before buying</option>
              <option value="first_click">The first link that ever brought them here</option>
            </select>
          </Field>
          <Field
            label="How long you remember a referral"
            hint="from the last time they clicked"
          >
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={365}
                value={settings.cookieWindowDays}
                onChange={(e) =>
                  setSettings({ ...settings, cookieWindowDays: Number(e.target.value) || 30 })
                }
                className="pr-16"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
              >
                days
              </span>
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Paying them" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field
            label="Hold their earnings for"
            hint="so a refund doesn't leave you chasing money back"
          >
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={365}
                value={settings.holdDays}
                onChange={(e) => setSettings({ ...settings, holdDays: Number(e.target.value) || 0 })}
                className="pr-16"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
              >
                days
              </span>
            </div>
          </Field>
          <Field label="Where a partner's link lands" hint="if they haven't chosen a page">
            <Input
              value={settings.landingPath}
              onChange={(e) => setSettings({ ...settings, landingPath: e.target.value })}
              placeholder="/"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink sm:col-span-2">
            <input
              type="checkbox"
              checked={settings.autoApprove}
              onChange={(e) => setSettings({ ...settings, autoApprove: e.target.checked })}
              className="size-4 rounded border-hairline text-plum"
            />
            Let anyone who applies start straight away, without waiting for you
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="What they read before applying" />
        <div className="grid gap-4 p-5">
          <Field label="Your invitation" hint="shown on the partner page">
            <Textarea
              rows={6}
              value={settings.pitchMd}
              onChange={(e) => setSettings({ ...settings, pitchMd: e.target.value })}
              placeholder="Who this is for and what they get."
            />
          </Field>
          <Field label="Your partner terms">
            <Textarea
              rows={8}
              value={settings.termsMd}
              onChange={(e) => setSettings({ ...settings, termsMd: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ page */

export default function Affiliates() {
  const [tab, setTab] = useState<Tab>("partners");
  const [error, setError] = useState<string | null>(null);

  const onError = useCallback((message: string) => setError(message), []);

  const body: Record<Tab, ReactNode> = {
    partners: <PartnersTab onError={onError} />,
    payments: <PaymentsTab onError={onError} />,
    creative: <CreativeTab onError={onError} />,
    news: <NewsTab onError={onError} />,
    howitworks: <HowItWorksTab onError={onError} />,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Partners"
        description="People who recommend your work and earn a share of what they send you."
      />

      {error && <ErrorNotice message={error} />}

      <TabBar
        active={tab}
        onChange={(next) => {
          setError(null);
          setTab(next);
        }}
      />

      {body[tab]}
    </div>
  );
}

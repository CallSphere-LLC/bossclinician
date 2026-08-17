import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  Link2,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  memberAffiliateApi,
  type CommissionRow,
  type PartnerAnnouncement,
  type PartnerAsset,
  type PartnerLink,
  type PartnerOverview,
  type PayoutRow,
} from "@/lib/affiliateApi";

/**
 * The partner's dashboard.
 *
 * This is a customer-facing surface, not a console, so it stays on the Obsidian
 * Luxe brand and leads with the two things a partner opens it to find: their
 * link, and what they are owed.
 *
 * The money is deliberately shown as three separate figures rather than one
 * balance. "Still clearing" is money earned inside the refund window; "ready to
 * pay" has cleared it; "paid so far" is history. A single number would be right
 * on the day it was computed and wrong the moment a refund landed, and the
 * partner would have no way of seeing which.
 */

const REFRESH_LABEL = "We couldn't load that just now. Please try again in a moment.";

function useCopy(): [string | null, (value: string, id: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback((value: string, id: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => toast.error("Your browser wouldn't let us copy that — select it and copy."));
  }, []);

  return [copied, copy];
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <GlassCard interactive={false} spotlight={false} className="p-5">
      <p className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-orchid">
        {label}
      </p>
      <p className="mt-2 font-display text-[1.6rem] leading-none text-white">{value}</p>
      {hint && <p className="mt-2 text-xs text-orchid-faint">{hint}</p>}
    </GlassCard>
  );
}

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <GlassCard interactive={false} spotlight={false} className="p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-[1.25rem] leading-tight text-white">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-orchid-dim">{description}</p>}
        </div>
        {action}
      </div>
      <div aria-hidden className="rule-faint mt-5 w-full" />
      <div className="mt-6">{children}</div>
    </GlassCard>
  );
}

/** A commission row in the words a partner reads it in. */
function describeRow(row: CommissionRow): { label: string; tone: "gold" | "green" | "neutral" } {
  if (row.kind === "clawback") return { label: "Refunded — reversed", tone: "neutral" };
  if (row.status === "paid") return { label: "Paid", tone: "green" };
  if (row.payableAt && new Date(row.payableAt) > new Date()) {
    return { label: `Clears ${formatDate(row.payableAt)}`, tone: "neutral" };
  }
  return { label: "Ready to pay", tone: "gold" };
}

export default function AffiliatePortal() {
  const [overview, setOverview] = useState<PartnerOverview | null>(null);
  const [links, setLinks] = useState<PartnerLink[] | null>(null);
  const [assets, setAssets] = useState<PartnerAsset[]>([]);
  const [announcements, setAnnouncements] = useState<PartnerAnnouncement[]>([]);
  const [transactions, setTransactions] = useState<CommissionRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [error, setError] = useState("");
  const [copied, copy] = useCopy();

  const [newLabel, setNewLabel] = useState("");
  const [newPath, setNewPath] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  const [payoutMethod, setPayoutMethod] = useState("");
  const [payoutDetails, setPayoutDetails] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);

  const loadLinks = useCallback(async () => {
    const page = await memberAffiliateApi.links();
    setLinks(page.links);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await memberAffiliateApi.overview();
        if (cancelled) return;
        setOverview(data);
        setPayoutMethod(data.partner?.payoutMethod ?? "");
        setPayoutDetails(data.partner?.payoutDetails ?? "");

        // Everything below only exists for an approved partner, and each piece
        // fails on its own: a missing announcement must not blank the earnings.
        if (data.partner) {
          await Promise.allSettled([
            loadLinks(),
            memberAffiliateApi.assets().then((r) => !cancelled && setAssets(r.assets)),
            memberAffiliateApi
              .announcements()
              .then((r) => !cancelled && setAnnouncements(r.announcements)),
            memberAffiliateApi
              .transactions({ limit: 25 })
              .then((r) => !cancelled && setTransactions(r.transactions)),
            memberAffiliateApi.payouts().then((r) => !cancelled && setPayouts(r.payouts)),
          ]);
        }
      } catch {
        if (!cancelled) setError(REFRESH_LABEL);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLinks]);

  async function addLink(event: FormEvent) {
    event.preventDefault();
    const path = newPath.trim();
    if (!path.startsWith("/")) {
      toast.error("Start the address with a / — for example /store");
      return;
    }
    setSavingLink(true);
    try {
      await memberAffiliateApi.createLink({ label: newLabel.trim(), destinationPath: path });
      setNewLabel("");
      setNewPath("");
      await loadLinks();
      toast.success("Link created");
    } catch {
      toast.error("We couldn't create that link. Check the address and try again.");
    } finally {
      setSavingLink(false);
    }
  }

  async function removeLink(id: number) {
    try {
      await memberAffiliateApi.deleteLink(id);
      await loadLinks();
    } catch {
      toast.error("We couldn't remove that link just now.");
    }
  }

  async function savePayout(event: FormEvent) {
    event.preventDefault();
    setSavingPayout(true);
    try {
      await memberAffiliateApi.savePayoutDetails({ payoutMethod, payoutDetails });
      toast.success("Payment details saved");
    } catch {
      toast.error("We couldn't save those details just now.");
    } finally {
      setSavingPayout(false);
    }
  }

  const partner = overview?.partner ?? null;
  const stats = overview?.stats;

  return (
    <MemberShell
      title="Partner program"
      description="Share what you love, and earn on every sale you send."
    >
      <Seo title="Partner Program | Boss Clinician" />

      {error && (
        <GlassCard interactive={false} spotlight={false} className="p-6">
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        </GlassCard>
      )}

      {!error && overview === null && (
        <GlassCard interactive={false} spotlight={false} className="p-6">
          <p className="text-sm text-orchid-dim">Loading…</p>
        </GlassCard>
      )}

      {/* Not a partner yet: the invitation, not an error. */}
      {overview !== null && partner === null && (
        <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-10">
          <h2 className="font-display text-[1.6rem] leading-tight text-white">
            You're not a partner yet
          </h2>
          <p className="copy-luxe mt-3 max-w-xl">
            Recommend the work you already talk about, and earn{" "}
            {overview.program?.commission.kind === "fixed"
              ? formatCurrency(overview.program.commission.amountCents ?? 0)
              : `${overview.program?.commission.percent ?? 0}%`}{" "}
            on every sale you send our way.
          </p>
          <div className="mt-7">
            <LuxeButton to="/partners">Apply to join</LuxeButton>
          </div>
        </GlassCard>
      )}

      {partner && (
        <div className="space-y-8">
          {partner.status !== "approved" && (
            <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6">
              <p className="text-sm text-white">
                {partner.status === "pending"
                  ? "Your application is with us — we'll email you as soon as it's approved."
                  : "Your partner account is on hold. Get in touch and we'll sort it out."}
              </p>
            </GlassCard>
          )}

          {/* ── Money first ─────────────────────────────────────────────── */}
          {stats && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Ready to pay"
                value={formatCurrency(stats.payableCents)}
                hint="Goes out in the next payment run."
              />
              <StatTile
                label="Still clearing"
                value={formatCurrency(stats.pendingCents)}
                hint={`Held for ${overview?.holdDays ?? 30} days in case of a refund.`}
              />
              <StatTile label="Paid so far" value={formatCurrency(stats.paidCents)} />
              <StatTile
                label="People you've sent"
                value={String(stats.referred)}
                hint={`From ${stats.clicks} click${stats.clicks === 1 ? "" : "s"}.`}
              />
            </div>
          )}

          {/* ── The link ────────────────────────────────────────────────── */}
          <Panel
            title="Your link"
            description={
              overview?.commission
                ? `You earn ${
                    overview.commission.kind === "fixed"
                      ? formatCurrency(overview.commission.amountCents ?? 0)
                      : `${overview.commission.percent ?? 0}%`
                  } on every sale, and we remember your referral for ${
                    overview.cookieWindowDays ?? 30
                  } days.`
                : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/85">
                {partner.shareLink}
              </code>
              <LuxeButton
                variant="glass"
                onClick={() => copy(partner.shareLink, "main")}
                className="shrink-0"
              >
                {copied === "main" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === "main" ? "Copied" : "Copy"}
              </LuxeButton>
            </div>
          </Panel>

          {/* ── Extra links ─────────────────────────────────────────────── */}
          <Panel
            title="Links to particular pages"
            description="Send people straight to a course or the shop instead of the home page."
          >
            <form onSubmit={addLink} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <LuxeInput
                label="What it's for"
                placeholder="Instagram bio"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                maxLength={120}
              />
              <LuxeInput
                label="Page on the site"
                placeholder="/store"
                hint="Starts with a /"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                maxLength={400}
                required
              />
              <LuxeButton disabled={savingLink} className="h-12">
                <Plus className="size-4" />
                {savingLink ? "Adding…" : "Add"}
              </LuxeButton>
            </form>

            <div className="mt-6 space-y-3">
              {links === null && <p className="text-sm text-orchid-dim">Loading your links…</p>}
              {links?.length === 0 && (
                <p className="text-sm text-orchid-dim">
                  No extra links yet — the one above works everywhere.
                </p>
              )}
              {links?.map((link) => (
                <div
                  key={link.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <Link2 aria-hidden className="size-4 shrink-0 text-gold" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {link.label || link.destinationPath}
                    </p>
                    <p className="truncate text-xs text-orchid-faint">{link.url}</p>
                  </div>
                  <LuxePill accent="neutral">
                    {link.clicks} click{link.clicks === 1 ? "" : "s"}
                  </LuxePill>
                  <button
                    type="button"
                    onClick={() => copy(link.url, String(link.id))}
                    aria-label={`Copy the link for ${link.label || link.destinationPath}`}
                    className="rounded-full p-2 text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    {copied === String(link.id) ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeLink(link.id)}
                    aria-label={`Remove the link for ${link.label || link.destinationPath}`}
                    className="rounded-full p-2 text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          {/* ── News ────────────────────────────────────────────────────── */}
          {announcements.length > 0 && (
            <Panel title="News for partners">
              <div className="space-y-6">
                {announcements.map((item) => (
                  <article key={item.id}>
                    <div className="flex items-center gap-2">
                      <Megaphone aria-hidden className="size-4 text-gold" />
                      <h3 className="font-display text-base text-white">{item.title}</h3>
                      <span className="text-xs text-orchid-faint">
                        {formatDate(item.publishedAt)}
                      </span>
                    </div>
                    <div className="prose-boss mt-2 break-words text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.bodyMd}</ReactMarkdown>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
          )}

          {/* ── Creative ────────────────────────────────────────────────── */}
          {assets.length > 0 && (
            <Panel
              title="Things you can use"
              description="Images, wording and anything else worth borrowing."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{asset.title}</p>
                        {asset.offerTitle && (
                          <p className="truncate text-xs text-orchid-faint">{asset.offerTitle}</p>
                        )}
                      </div>
                      {asset.url && (
                        <a
                          href={asset.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${asset.title}`}
                          className="shrink-0 rounded-full p-2 text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
                        >
                          <Download className="size-4" />
                        </a>
                      )}
                    </div>
                    {asset.bodyMd && (
                      <div className="prose-boss mt-3 break-words text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{asset.bodyMd}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* ── The ledger ──────────────────────────────────────────────── */}
          <Panel
            title="What you've earned"
            description="Every sale, and every refund that reversed one."
          >
            {transactions.length === 0 ? (
              <p className="text-sm text-orchid-dim">
                Nothing yet — earnings appear here as soon as somebody buys through your link.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="text-[0.64rem] uppercase tracking-[0.14em] text-orchid">
                      <th scope="col" className="pb-3 pr-4 font-semibold">
                        What
                      </th>
                      <th scope="col" className="pb-3 pr-4 font-semibold">
                        When
                      </th>
                      <th scope="col" className="pb-3 pr-4 font-semibold">
                        Status
                      </th>
                      <th scope="col" className="pb-3 text-right font-semibold">
                        You earned
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {transactions.map((row) => {
                      const described = describeRow(row);
                      return (
                        <tr key={row.id}>
                          <td className="py-3 pr-4 text-white/85">
                            {row.offerTitle ?? "A purchase"}
                          </td>
                          <td className="py-3 pr-4 text-orchid-dim">{formatDate(row.createdAt)}</td>
                          <td className="py-3 pr-4">
                            <LuxePill accent={described.tone}>{described.label}</LuxePill>
                          </td>
                          <td
                            className={cn(
                              "py-3 text-right font-medium tabular-nums",
                              row.amountCents < 0 ? "text-red-400" : "text-white",
                            )}
                          >
                            {formatCurrency(row.amountCents, row.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* ── Payments out ────────────────────────────────────────────── */}
          <Panel
            title="Payments to you"
            description="What's been sent, and where it went."
          >
            {payouts.length === 0 ? (
              <p className="text-sm text-orchid-dim">No payments yet.</p>
            ) : (
              <ul className="space-y-3">
                {payouts.map((payout) => (
                  <li
                    key={payout.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white">
                        {formatCurrency(payout.amountCents, payout.currency)}
                      </p>
                      <p className="text-xs text-orchid-faint">
                        {payout.paidAt
                          ? `Sent ${formatDate(payout.paidAt)}`
                          : "On its way"}
                        {payout.reference ? ` · ${payout.reference}` : ""}
                      </p>
                    </div>
                    <LuxePill accent={payout.status === "paid" ? "green" : "neutral"}>
                      {payout.status === "paid" ? "Sent" : "Being prepared"}
                    </LuxePill>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={savePayout} className="mt-8 grid gap-4 sm:grid-cols-2">
              <LuxeInput
                label="How you'd like to be paid"
                placeholder="PayPal"
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                maxLength={120}
              />
              <LuxeInput
                label="Where to send it"
                placeholder="you@example.com"
                value={payoutDetails}
                onChange={(e) => setPayoutDetails(e.target.value)}
                maxLength={500}
              />
              <div className="sm:col-span-2">
                <LuxeButton variant="outline" disabled={savingPayout}>
                  {savingPayout ? "Saving…" : "Save payment details"}
                </LuxeButton>
              </div>
            </form>
          </Panel>

          {overview?.termsMd && (
            <Panel title="The terms you agreed to">
              <div className="prose-boss break-words text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{overview.termsMd}</ReactMarkdown>
              </div>
            </Panel>
          )}

          <p className="text-center text-xs text-orchid-faint">
            Questions about a payment? <Link to="/contact" className="text-gold">Get in touch</Link>.
          </p>
        </div>
      )}
    </MemberShell>
  );
}

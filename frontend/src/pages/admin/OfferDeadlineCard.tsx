import { useState, type ReactNode } from "react";
import { Copy, Timer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { countdownPageLine, type Offer } from "@/lib/adminCommerceApi";
import { Button, Card, CardHeader, Field, Input, selectStyles } from "@/pages/admin/ui/primitives";
import { shareLink } from "@/pages/admin/ui/friendly";
import { isoToSiteWallTime, siteWallTimeToIso, useSiteTime } from "@/pages/admin/ui/siteTime";

/**
 * "Sale deadline and countdown": when an offer stops taking new orders, where
 * visitors go once it has, and the three places its timer can be shown.
 *
 * The date and time are typed and read on the SITE's clock, not the clock of
 * whoever is looking: the stored instant is the only state, and the two boxes
 * are worked out from it on every render. That is what keeps an assistant in
 * another city, a late-arriving zone setting, and a switch of tabs from each
 * moving the deadline by a few hours.
 */

/* ── The fields, and the rules for them ─────────────────────────────────── */

export interface DeadlineDraft {
  salesEndAt?: string | null;
  afterCloseOfferId?: number | null;
  afterClosePath?: string;
  showCountdown?: boolean;
}

/** A date with no time means "the end of that day". */
export const DEFAULT_DEADLINE_TIME = "23:59";

/**
 * The two boxes → the instant to store. No date means no deadline; a date with
 * the time left empty runs to 11:59 PM that day.
 */
export function deadlineFromInputs(date: string, time: string, timeZone: string): string | null {
  if (!date) return null;
  return siteWallTimeToIso(date, time || DEFAULT_DEADLINE_TIME, timeZone);
}

/**
 * Why a "page on this site" can't be used, or null when it can.
 *
 * Only an address on her own site is allowed: a sale that has ended must never
 * be a way to bounce visitors to somebody else's website, and pointing an offer
 * at its own checkout would send them round in a circle.
 */
export function afterClosePathError(path: string, ownSlug?: string | null): string | null {
  const value = path.trim();
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("\\")) {
    return "Use a page on this site, like /store. Links to other websites can't be used here.";
  }
  if (!value.startsWith("/")) return "Start the page address with a slash, like /store.";
  if (/[\s\\]/.test(value)) return "A page address can't contain spaces or backslashes.";
  if (ownSlug) {
    const bare = (value.split(/[?#]/)[0] ?? "").replace(/\/+$/, "").toLowerCase();
    if (bare === `/checkout/${ownSlug.toLowerCase()}`) {
      return "That is this offer's own checkout page. Choose a different page.";
    }
  }
  return null;
}

/** What stops a save, keyed by field. Empty when the deadline settings are fine. */
export function offerDeadlineErrors(
  draft: DeadlineDraft,
  own: { id?: number | null; slug?: string | null } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.salesEndAt && Number.isNaN(Date.parse(draft.salesEndAt))) {
    errors.salesEndAt = "We couldn't read that date. Choose the day and time again.";
  }
  if (draft.afterCloseOfferId != null && own.id != null && draft.afterCloseOfferId === own.id) {
    errors.afterCloseOfferId = "An offer can't send visitors back to itself. Choose a different offer.";
  }
  const pathError = afterClosePathError(draft.afterClosePath ?? "", own.slug);
  if (pathError) errors.afterClosePath = pathError;
  return errors;
}

/**
 * A caution about the offer visitors are sent on to, or null when it is a
 * sound choice. Sending people from one ended offer to another ended offer
 * leaves them with nothing to buy, which is the opposite of what she asked for.
 */
export function afterCloseWarning(
  target: Pick<Offer, "title" | "status" | "salesEndAt"> | undefined,
  salesEndAt: string | null | undefined,
  now: number,
  formatDeadline: (iso: string) => string,
): string | null {
  if (!target) return null;
  if (target.status !== "published") {
    return `"${target.title}" is not live right now, so visitors would only see a note that the offer has ended. Put it live, or choose another offer.`;
  }
  const targetEnds = target.salesEndAt ? Date.parse(target.salesEndAt) : Number.NaN;
  if (Number.isNaN(targetEnds)) return null;
  const label = formatDeadline(target.salesEndAt as string);
  if (targetEnds <= now) {
    return `"${target.title}" has already ended (${label}). Choose an offer that is still open.`;
  }
  const ends = salesEndAt ? Date.parse(salesEndAt) : Number.NaN;
  if (!Number.isNaN(ends) && targetEnds <= ends) {
    return `"${target.title}" ends ${label}, which is not after this sale ends. Visitors would be sent to an offer that has ended too. Choose one that stays open longer.`;
  }
  return null;
}

/** Whether a stored deadline is already behind us. */
export function deadlinePassed(salesEndAt: string | null | undefined, now: number): boolean {
  const ends = salesEndAt ? Date.parse(salesEndAt) : Number.NaN;
  return !Number.isNaN(ends) && ends <= now;
}

/** Same instant, however each side happens to spell it. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Date.parse(a) === Date.parse(b);
}

/* ── Small pieces, matching the offer editor's own ──────────────────────── */

function Caution({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/[0.09] px-4 py-3 text-sm text-ink">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function CopyRow({
  label,
  value,
  hint,
  copied,
}: {
  label: string;
  value: string;
  hint: string;
  copied: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(copied);
    } catch {
      toast.error("Your browser wouldn't let us copy that. Please try again.");
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-[0.8rem] font-semibold text-ink">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-xl border border-hairline bg-white/[0.02] px-3.5 py-2.5 font-mono text-xs text-ink">
          {value}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={`Copy: ${label}`}
          onClick={() => void copy()}
        >
          <Copy />
          Copy
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-ink-soft">{hint}</p>
    </div>
  );
}

/* ── The card ───────────────────────────────────────────────────────────── */

const DESTINATION_NONE = "";
const DESTINATION_PATH = "path";

export default function OfferDeadlineCard({
  draft,
  errors,
  update,
  offer,
  offers,
}: {
  draft: DeadlineDraft;
  errors: Record<string, string>;
  update: (patch: DeadlineDraft) => void;
  /** The saved offer, or null while it is still a brand-new, unsaved one. */
  offer: Pick<Offer, "id" | "slug" | "status" | "salesEndAt"> | null;
  /** Every offer, for the "send visitors to" list. */
  offers: Offer[];
}) {
  const time = useSiteTime();
  const [now] = useState(() => Date.now());

  const salesEndAt = draft.salesEndAt ?? null;
  const wall = isoToSiteWallTime(salesEndAt, time.timeZone);
  const dateValue = wall?.date ?? "";
  const timeValue = wall?.time ?? "";

  const targetId = draft.afterCloseOfferId ?? null;
  const path = draft.afterClosePath ?? "";
  // Held, as the "After purchase" tab holds its own choice: picking "A page on
  // this site" before typing an address stores nothing yet, and a choice worked
  // out from the stored fields alone would snap straight back.
  const [wantsPath, setWantsPath] = useState(false);
  const destination =
    targetId !== null ? `offer:${targetId}` : path || wantsPath ? DESTINATION_PATH : DESTINATION_NONE;

  const choices = offers
    .filter((other) => other.status === "published" && other.id !== offer?.id)
    .sort((a, b) => a.title.localeCompare(b.title));
  const target = targetId !== null ? offers.find((other) => other.id === targetId) : undefined;
  // A saved choice that has since been taken off sale stays in the list, so the
  // box never shows an offer she did not pick.
  const targetMissing = targetId !== null && !choices.some((other) => other.id === targetId);

  const targetWarning = afterCloseWarning(target, salesEndAt, now, time.deadline);
  const pathError = errors.afterClosePath ?? afterClosePathError(path, offer?.slug) ?? undefined;
  const passed = deadlinePassed(salesEndAt, now);
  const unsavedDeadline = offer !== null && !sameInstant(salesEndAt, offer.salesEndAt);

  function setDeadline(date: string, clock: string) {
    if (!date) {
      update({ salesEndAt: null });
      return;
    }
    const next = deadlineFromInputs(date, clock, time.timeZone);
    // A half-typed date is not a reason to wipe the deadline already set.
    if (next) update({ salesEndAt: next });
  }

  function chooseDestination(value: string) {
    if (value === DESTINATION_NONE) {
      setWantsPath(false);
      update({ afterCloseOfferId: null, afterClosePath: "" });
    } else if (value === DESTINATION_PATH) {
      setWantsPath(true);
      update({ afterCloseOfferId: null });
    } else {
      setWantsPath(false);
      // Only one destination can be in force, so choosing clears the other.
      update({ afterCloseOfferId: Number(value.slice("offer:".length)), afterClosePath: "" });
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Timer className="size-4" />}
        title="Sale deadline and countdown"
        subtitle="Optional. Close this offer at a set time and show a timer until then"
      />
      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Sale ends on" error={errors.salesEndAt}>
              <Input
                type="date"
                max="9999-12-31"
                value={dateValue}
                onChange={(e) => setDeadline(e.target.value, timeValue)}
              />
            </Field>
            <Field label="At" hint={time.zoneName}>
              <Input
                type="time"
                value={timeValue}
                disabled={!dateValue}
                title={dateValue ? undefined : "Choose the day first"}
                onChange={(e) => setDeadline(dateValue, e.target.value)}
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              disabled={!salesEndAt}
              onClick={() => update({ salesEndAt: null })}
            >
              Clear
            </Button>
          </div>

          {salesEndAt ? (
            <p className="text-sm text-ink-soft" aria-live="polite">
              New orders stop on{" "}
              <strong className="font-bold tabular-nums text-ink">{time.deadline(salesEndAt)}</strong>. Times
              here are in {time.zoneName}, wherever you are when you type them.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">
              No end date, so this offer stays open until you stop selling it. Pick a day to set a
              deadline. If you leave the time alone it ends at{" "}
              <strong className="font-bold tabular-nums text-ink">11:59 PM</strong> {time.zoneName}.
            </p>
          )}

          {passed && (
            <Caution>
              That time has already passed. Once you save, this offer stops taking new orders straight
              away.
            </Caution>
          )}

          <Field
            label="After it ends, send visitors to"
            hint="usually the regular-price offer"
            error={errors.afterCloseOfferId}
          >
            <select
              value={destination}
              onChange={(e) => chooseDestination(e.target.value)}
              aria-label="After it ends, send visitors to"
              className={selectStyles}
            >
              <option value={DESTINATION_NONE}>Nowhere. Just say the offer has ended</option>
              {targetMissing && (
                <option value={`offer:${targetId}`}>
                  {target ? `${target.title} (not live right now)` : "An offer that is no longer available"}
                </option>
              )}
              {choices.map((other) => (
                <option key={other.id} value={`offer:${other.id}`}>
                  {other.title}
                </option>
              ))}
              <option value={DESTINATION_PATH}>A page on this site…</option>
            </select>
          </Field>

          {destination === DESTINATION_PATH && (
            <Field label="Which page?" hint="starts with a slash, like /store" error={pathError}>
              <Input
                value={path}
                onChange={(e) => update({ afterClosePath: e.target.value.trim() })}
                placeholder="/store"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
          )}

          {targetMissing && !target && (
            <Caution>
              The offer chosen here can't be found any more, so visitors would only see a note that the
              offer has ended. Choose another one.
            </Caution>
          )}
          {targetWarning && <Caution>{targetWarning}</Caution>}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/20">
            <input
              type="checkbox"
              checked={draft.showCountdown !== false}
              onChange={(e) => update({ showCountdown: e.target.checked })}
              className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">
                Show the countdown on the checkout and sales page
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                Turn this off to keep the deadline but hide the ticking timer on those pages.
              </span>
            </span>
          </label>

          <p className="text-sm text-ink-soft">
            Orders started before the deadline can still finish paying.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-hairline bg-white/[0.02] p-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              Where to show the timer
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              The checkout page and the course sales page show it on their own. These are for
              everywhere else.
            </p>
          </div>

          {offer ? (
            <>
              {!salesEndAt && (
                <p className="text-sm text-ink-soft">
                  Set an end date first. Until then there is no timer to show.
                </p>
              )}
              {salesEndAt && unsavedDeadline && (
                <p className="text-sm font-medium text-ink" role="status">
                  Press Save to start using this deadline.
                </p>
              )}
              {salesEndAt && offer.status !== "published" && (
                <p className="text-sm text-ink-soft">
                  This offer is not live yet. The link and the timer start working once you put it live.
                </p>
              )}
              <CopyRow
                label="Sale link"
                value={shareLink("checkout", offer.slug)}
                hint="Share this anywhere. Once the sale ends, it takes visitors to the place you chose instead."
                copied="Sale link copied."
              />
              <CopyRow
                label="Timer for a funnel page"
                value={countdownPageLine(offer.slug)}
                hint="Paste this on a line of its own in a funnel page's text and the live timer appears there. The funnel editor's Add countdown button does it for you."
                copied="Timer line copied."
              />
              <div>
                <p className="mb-1.5 text-[0.8rem] font-semibold text-ink">Timer for an email</p>
                <p className="text-sm text-ink-soft">
                  Nothing to copy. While writing an email, press the Countdown timer button above the
                  message and choose this offer. It adds the timer picture, the link and a line with
                  the end date.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              Save this offer first. Its sale link and timer line appear here once it has a web
              address.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

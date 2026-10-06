import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { ArrowLeft, ExternalLink, Eye, Loader2, Monitor, Smartphone, Tablet, TriangleAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { sessionFetch } from "@/lib/adminTransport";
import { CLUB_OFFER_SLUG } from "@/content/club";
import type { OfferQuote, PublicOffer, QuoteInput } from "@/lib/commerceApi";
import {
  CheckoutPreviewProvider,
  type CheckoutPreviewPage,
  type CheckoutPreviewSource,
} from "@/components/checkout/checkoutPreview";
import { CheckoutExperience, CheckoutShell } from "@/pages/Checkout";
import ClubCheckout from "@/pages/ClubCheckout";
import { loginPathFor } from "@/pages/admin/adminReturnTo";
import { shareLink } from "@/pages/admin/ui/friendly";
import { cn } from "@/lib/cn";

/**
 * `/admin/offers/:id/checkout-preview` — "Preview checkout", Kajabi's
 * per-offer Preview.
 *
 * The checkout page exactly as a buyer gets it, for any offer status, opened
 * from the offers list or the offer editor in a new tab. It draws nothing of
 * its own below the preview bar: it mounts the real `CheckoutExperience`
 * (inside the real `CheckoutShell`), or for the Club offer the real
 * `ClubCheckout` page, under a `CheckoutPreviewProvider` that
 *
 *  - reads the offer and its quotes from `/api/admin/offers/:id/checkout-preview`
 *    (admin session, read-only, answers for drafts — the public offer routes
 *    refuse those by design, and the admin's `__Host-` cookie never reaches the
 *    public host, so a public-URL preview could not tell who is asking);
 *  - tells the form to send nothing: no abandoned-cart capture on the email
 *    field, no `/checkout` call, no PaymentIntent, and no Stripe.js — the card
 *    form is drawn as a placeholder. "Pay" runs the buyer's field checks and
 *    then says that nothing was charged.
 *
 * Outside AdminLayout on purpose, like the course preview: the console chrome
 * would be the first thing to make this stop looking like the buyer's page.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

interface PreviewInfo {
  status: string;
  publicPath: string;
  deliverabilityIssue: string | null;
  checkoutSettings: Record<string, unknown>;
}

type PreviewOffer = PublicOffer & { preview: PreviewInfo };

class PreviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function previewRequest<T>(offerId: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await sessionFetch(
    `${API_BASE}/admin/offers/${encodeURIComponent(offerId)}/checkout-preview${path}`,
    { ...options, headers },
  );
  if (!res.ok) {
    let message = "We couldn't open this preview. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new PreviewError(message, res.status);
  }
  return (await res.json()) as T;
}

/** The sizes the device buttons open, in CSS pixels (iPhone 15, iPad Air). */
const DEVICE_WINDOWS = {
  phone: { width: 393, height: 852, label: "Phone", icon: Smartphone },
  tablet: { width: 820, height: 1180, label: "Tablet", icon: Tablet },
} as const;

/**
 * Opens the same preview in a window the size of the device.
 *
 * A narrower container would not do: the checkout's layout switches on the
 * viewport (`lg:`), not on its box, so only a real narrow window shows the
 * phone layout. An iframe is not an option either — the admin host sends
 * `frame-ancestors 'none'`.
 */
function openDeviceWindow(device: keyof typeof DEVICE_WINDOWS): void {
  const { width, height } = DEVICE_WINDOWS[device];
  window.open(
    `${window.location.pathname}${window.location.search}`,
    `bc-checkout-preview-${device}`,
    `popup=yes,width=${width},height=${height},noopener`,
  );
}

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  published: { text: "Published", tone: "border-green-bright/40 bg-green-bright/10 text-green-bright" },
  draft: { text: "Draft — not on sale yet", tone: "border-gold/40 bg-gold/10 text-gold" },
  archived: { text: "Archived — not on sale", tone: "border-white/20 bg-white/5 text-orchid" },
};

export default function CheckoutPreview() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenStatus>Just a moment…</FullScreenStatus>;
  // The same sign-in guard as every console screen; ?next= brings her back here.
  if (!user) return <Navigate to={loginPathFor(location)} replace />;
  return <CheckoutPreviewScreen />;
}

function CheckoutPreviewScreen() {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offer, setOffer] = useState<PreviewOffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOffer(null);
    setLoadError(null);
    previewRequest<PreviewOffer>(id, "")
      .then((result) => {
        if (!cancelled) setOffer(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "We couldn't open this preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isClubOffer = offer?.slug === CLUB_OFFER_SLUG;
  // The Club is sold from its own page (/club/checkout), so that is what its
  // preview opens on; the plain /checkout/the-club form is one click away.
  const page: CheckoutPreviewPage = isClubOffer && searchParams.get("page") !== "checkout" ? "club" : "checkout";

  useEffect(() => {
    if (offer) document.title = `Preview: ${offer.title} checkout - Boss Clinician`;
  }, [offer]);

  // Stable for the life of the offer: the form's effects depend on it.
  const source = useMemo<CheckoutPreviewSource | null>(
    () =>
      offer && {
        getOffer: () => Promise.resolve(offer),
        quote: (_slug: string, input: QuoteInput) =>
          previewRequest<OfferQuote>(id, "/quote", { method: "POST", body: JSON.stringify(input) }),
        checkoutSettings: offer.preview.checkoutSettings ?? {},
      },
    [offer, id],
  );

  if (loadError !== null) {
    return (
      <FullScreenStatus>
        <span className="block max-w-md text-center">
          <span className="block font-display text-2xl text-white">This preview isn&apos;t available</span>
          <span className="mt-3 block text-sm text-orchid">{loadError}</span>
          <Link to="/admin/offers" className="mt-6 inline-flex items-center gap-2 text-sm text-gold underline underline-offset-4">
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Back to offers
          </Link>
        </span>
      </FullScreenStatus>
    );
  }

  if (offer === null || source === null) {
    return (
      <FullScreenStatus>
        <Loader2 aria-hidden className="h-5 w-5 animate-spin text-gold" />
        Opening the preview…
      </FullScreenStatus>
    );
  }

  const status = STATUS_LABEL[offer.preview.status] ?? { text: offer.preview.status, tone: STATUS_LABEL.archived.tone };
  const livePath = page === "club" ? shareLink("club", "checkout") : shareLink("checkout", offer.slug);

  function choosePage(next: CheckoutPreviewPage) {
    setSearchParams(next === "checkout" ? { page: "checkout" } : {}, { replace: true });
  }

  return (
    <div className="theme-luxe min-h-screen bg-night-deep">
      <div
        role="region"
        aria-label="Checkout preview"
        className="sticky top-0 z-50 border-b border-gold/30 bg-night-deep/95 px-4 py-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.7)] backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-[22rem] items-start gap-3">
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold-foil px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-night-deep">
              <Eye aria-hidden className="h-3.5 w-3.5" />
              Preview
            </span>
            <p className="min-w-0 text-sm leading-snug text-white">
              This is how buyers see your checkout. Payments are disabled in preview.
              <span className={cn("ml-2 inline-block rounded-full border px-2 py-0.5 align-middle text-[0.7rem] font-semibold", status.tone)}>
                {status.text}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isClubOffer && (
              <div role="group" aria-label="Which page" className="inline-flex rounded-lg border border-white/15 p-0.5">
                {(["club", "checkout"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={page === value}
                    onClick={() => choosePage(value)}
                    className={cn(
                      "min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors",
                      page === value ? "bg-gold/15 text-gold" : "text-orchid hover:text-white",
                    )}
                  >
                    {value === "club" ? "Club page" : "Standard checkout"}
                  </button>
                ))}
              </div>
            )}

            <div role="group" aria-label="Screen size" className="inline-flex rounded-lg border border-white/15 p-0.5">
              <span
                aria-current="true"
                title="You're looking at the desktop size"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-gold/15 px-3 text-xs font-semibold text-gold"
              >
                <Monitor aria-hidden className="h-3.5 w-3.5" />
                Desktop
              </span>
              {(Object.keys(DEVICE_WINDOWS) as (keyof typeof DEVICE_WINDOWS)[]).map((device) => {
                const { label, icon: Icon } = DEVICE_WINDOWS[device];
                return (
                  <button
                    key={device}
                    type="button"
                    onClick={() => openDeviceWindow(device)}
                    title={`Open a ${label.toLowerCase()}-sized preview window`}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-orchid transition-colors hover:text-white"
                  >
                    <Icon aria-hidden className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>

            <Link
              to={`/admin/offers/${encodeURIComponent(String(offer.id))}`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-orchid hover:text-white"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              Edit offer
            </Link>
            {offer.preview.status === "published" && (
              <a
                href={livePath}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-orchid hover:text-white"
              >
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                Open live page
              </a>
            )}
          </div>
        </div>

        {(offer.preview.status !== "published" || offer.preview.deliverabilityIssue) && (
          <div className="mx-auto mt-2 max-w-6xl space-y-1 text-xs leading-relaxed text-orchid">
            {offer.preview.status !== "published" && (
              <p>
                Buyers can&apos;t open this checkout until the offer is published — the link{" "}
                <span className="font-semibold text-white">{shareLink("checkout", offer.slug).replace(/^https?:\/\//, "")}</span>{" "}
                shows &ldquo;not available&rdquo; for now.
              </p>
            )}
            {offer.preview.deliverabilityIssue && (
              <p className="flex items-start gap-1.5 text-gold">
                <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span>Buyers would be stopped at checkout right now: {offer.preview.deliverabilityIssue}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <CheckoutPreviewProvider value={source}>
        {page === "club" ? (
          // /club/checkout lives inside the site Layout, which is what supplies
          // `theme-luxe` there; the same classes stand in for it here.
          <div className="theme-luxe grain-overlay flex min-h-screen flex-col overflow-x-clip bg-night-deep">
            <ClubCheckout />
          </div>
        ) : (
          <CheckoutShell>
            {/* Keyed on the offer so a reload of the data starts the form clean. */}
            <CheckoutExperience key={offer.id} offer={offer} />
          </CheckoutShell>
        )}
      </CheckoutPreviewProvider>
    </div>
  );
}

function FullScreenStatus({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="theme-luxe flex min-h-screen items-center justify-center gap-3 bg-night-deep px-4 text-orchid-dim"
    >
      {children}
    </div>
  );
}

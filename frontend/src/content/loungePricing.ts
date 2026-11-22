/**
 * Lounge prices by phase (Yvette, 22 Nov 2026, item 1). The server decides the
 * phase from paid enrolments (backend/src/services/loungeSeats.ts); this file
 * only holds the words and figures each phase prints.
 *
 *   Lounge Member: first 20 paid members $197/month or $1,997/year, then $247 / $2,497.
 *   Lounge VIP:    first 6 paid members $347/month or $3,497/year; when all 6 seats
 *                  are filled, a waitlist; when a seat frees, $447 / $4,497.
 */

export type LoungeTierId = "member" | "vip";
export type PricePhase = "founding" | "standard";

/** GET /api/lounge/pricing, one tier. */
export interface LoungeTierStatus {
  tier: "general" | "vip";
  phase: PricePhase;
  foundingLimit: number;
  foundingRemaining: number;
  capacity: number | null;
  seatsAvailable: number | null;
  waitlist: boolean;
  purchasable: boolean;
}

/** The same, as the checkout view carries it for the viewer (`seatPricing`). */
export interface LoungeSeatPricing extends LoungeTierStatus {
  viewerPhase: PricePhase;
  continuation: boolean;
}

export interface LoungePricingStatus {
  general: LoungeTierStatus;
  vip: LoungeTierStatus;
}

export interface PhasePrices {
  monthlyPrice: string;
  annualPrice: string;
  monthlyTerms: string;
  annualTerms: string;
}

export const LOUNGE_PRICES: Record<LoungeTierId, Record<PricePhase, PhasePrices>> = {
  member: {
    founding: {
      monthlyPrice: "$197/month",
      annualPrice: "$1,997 for 12 months",
      monthlyTerms: "Six-month minimum commitment. Your initial six-month commitment totals $1,182. After six months, membership continues month-to-month unless canceled.",
      annualTerms: "One upfront payment for 12 months of membership. Save $367 compared with paying $197 monthly for 12 months.",
    },
    standard: {
      monthlyPrice: "$247/month",
      annualPrice: "$2,497 for 12 months",
      monthlyTerms: "Six-month minimum commitment. Your initial six-month commitment totals $1,482. After six months, membership continues month-to-month unless canceled.",
      annualTerms: "One upfront payment for 12 months of membership. Save $467 compared with paying $247 monthly for 12 months.",
    },
  },
  vip: {
    founding: {
      monthlyPrice: "$347/month",
      annualPrice: "$3,497 for 12 months",
      monthlyTerms: "Six-month minimum commitment. Your initial six-month commitment totals $2,082. After six months, membership continues month-to-month unless canceled.",
      annualTerms: "One upfront payment for 12 months of VIP membership. Save $667 compared with paying $347 monthly for 12 months.",
    },
    standard: {
      monthlyPrice: "$447/month",
      annualPrice: "$4,497 for 12 months",
      monthlyTerms: "Six-month minimum commitment. Your initial six-month commitment totals $2,682. After six months, membership continues month-to-month unless canceled.",
      annualTerms: "One upfront payment for 12 months of VIP membership. Save $867 compared with paying $447 monthly for 12 months.",
    },
  },
};

/** Before the server answers (and if it cannot): today's state, founding open on both tiers. */
export const DEFAULT_LOUNGE_PRICING: LoungePricingStatus = {
  general: { tier: "general", phase: "founding", foundingLimit: 20, foundingRemaining: 20, capacity: null, seatsAvailable: null, waitlist: false, purchasable: true },
  vip: { tier: "vip", phase: "founding", foundingLimit: 6, foundingRemaining: 6, capacity: 6, seatsAvailable: 6, waitlist: false, purchasable: true },
};

export const VIP_WAITLIST_FORM_SLUG = "lounge-vip-waitlist";

/**
 * The line under each tier's prices, from her rules. Each tier changes on its
 * own limit.
 */
export function tierMessage(tier: LoungeTierId, status: LoungeTierStatus): string {
  if (tier === "member") {
    return status.phase === "founding"
      ? "Founding pricing: the first 20 paid Lounge Members join at $197/month or $1,997/year. Starting with the 21st paid member, pricing increases to $247/month or $2,497/year."
      : "The 20 founding Lounge Member places are filled. Membership is now $247/month or $2,497/year.";
  }
  if (status.phase === "founding") {
    return "Founding pricing: the first six paid VIP members join at $347/month or $3,497/year. Once all six seats are filled, VIP opens a waitlist.";
  }
  return status.waitlist
    ? "All six VIP seats are filled. Join the VIP waitlist: when a seat becomes available, the next VIP member can join at $447/month or $4,497/year."
    : "A VIP seat is available. The next VIP member joins at $447/month or $4,497/year.";
}

/** Shown at checkout to a signed-in founding member renewing while still enrolled. */
export const CONTINUATION_MESSAGE =
  "Your founding rate applies: founding members keep their original rate for as long as they remain continuously enrolled on the same plan.";

export const tierIdFor = (slug: string): LoungeTierId | null =>
  slug === "the-lounge-vip" ? "vip" : slug === "the-lounge" || slug === "lounge-billing-preview" ? "member" : null;

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export async function fetchLoungePricing(): Promise<LoungePricingStatus> {
  const res = await fetch(`${API_BASE}/lounge/pricing`, { cache: "no-store" });
  if (!res.ok) throw new Error(`lounge pricing ${res.status}`);
  return (await res.json()) as LoungePricingStatus;
}

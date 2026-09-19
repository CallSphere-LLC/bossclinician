/**
 * member-data.ts — answering "where is my receipt?" and "which course am I on?"
 * out of the member's own account.
 *
 * ONE rule governs this file: it reads the data of the person who is signed in,
 * and it has no way to name anybody else. There is no member id parameter, no
 * email lookup, nothing the model could be talked into filling with somebody
 * else's details — the server decides whose account this is from the session
 * behind `ctx.call`, exactly as the member's own screens do.
 *
 * Several modules can be switched off for a given business (coaching,
 * certificates), and a gated module answers with an error rather than an empty
 * list. So every call is settled independently: a portal without coaching still
 * gets a full answer about its courses and receipts.
 */

import type { ConciergeTool, ToolFn, VoiceContext } from "../contract";

/* The slices of each response this tool actually reads. Mirrors the server
 * shapes in backend/src/routes/member/, narrowed to what gets said out loud. */

type LibraryResponse = {
  total: number;
  items: { title: string; progress: { percent: number } | null; href: string }[];
  continueLesson: { title: string; moduleTitle: string; href: string } | null;
};

type BillingOverview = {
  purchaseCount: number;
  lifetimeSpend: string;
  activeSubscriptionCount: number;
  subscriptions: { planName: string; status: string; nextChargeAt: string | null }[];
  nextCharge: { at: string; amount: string; description: string } | null;
};

type OrdersPage = {
  orders: { id: number; title: string; status: string; createdAt: string; totalCents: number; currency: string }[];
};

type CertificatesResponse = {
  certificates: { courseTitle: string; issuedAt: string; creditHours: string; revoked: boolean }[];
};

type CoachingOverview = {
  /** `label` is already rendered in the member's own timezone by the server. */
  upcoming: { offerTitle: string; label: string; startsAt: string | null }[];
};

/** A settled read: the value, or null when that module is off or failed. */
async function settled<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function money(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return currency.toLowerCase() === "usd" ? `$${amount}` : `${amount} ${currency.toUpperCase()}`;
}

function shortDate(value: string | undefined | null): string {
  if (!value) return "";
  const at = new Date(value);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function buildMyAccountSummaryTool(toolFn: ToolFn, ctx: VoiceContext): ConciergeTool {
  return toolFn({
    name: "my_account_summary",
    description:
      "Look up THIS signed-in person's own account: the courses they own and how far through they are, what they have bought and where each receipt lives, any plan that renews, their certificates and any coaching booked. Call it whenever they ask about their own purchases, receipts, progress, renewals or bookings. It only ever returns their own account — it cannot look anyone else up.",
    strict: false,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    execute: async () => {
      const [library, billing, orders, certificates, coaching] = await Promise.all([
        settled(ctx.call.get<LibraryResponse>("/member/library")),
        settled(ctx.call.get<BillingOverview>("/member/billing/overview")),
        settled(ctx.call.get<OrdersPage>("/member/billing/orders?limit=5")),
        settled(ctx.call.get<CertificatesResponse>("/member/certificates")),
        settled(ctx.call.get<CoachingOverview>("/member/coaching")),
      ]);

      if (!library && !billing && !orders) {
        return "Their account could not be read just now — most likely they are signed out. Say so kindly and offer to take them to the sign-in page.";
      }

      const lines: string[] = ["THIS PERSON'S ACCOUNT (their own data only):"];

      if (library) {
        if (library.total === 0) {
          lines.push("Library: nothing bought yet.");
        } else {
          const shelf = library.items
            .slice(0, 6)
            .map((item) =>
              item.progress ? `${item.title} (${item.progress.percent}% done)` : item.title,
            )
            .join("; ");
          lines.push(`Library (${library.total}): ${shelf}`);
        }
        if (library.continueLesson) {
          lines.push(
            `Currently on: "${library.continueLesson.title}" in ${library.continueLesson.moduleTitle}. Pick up at ${library.continueLesson.href} — offer to take them there.`,
          );
        }
      }

      if (billing) {
        lines.push(
          `Purchases: ${billing.purchaseCount}, ${billing.lifetimeSpend} in total. Active plans: ${billing.activeSubscriptionCount}.`,
        );
        if (billing.nextCharge) {
          lines.push(
            `Next payment: ${billing.nextCharge.amount} for ${billing.nextCharge.description} on ${shortDate(billing.nextCharge.at)}.`,
          );
        }
      }

      if (orders?.orders.length) {
        // The receipt's permanent home is an app page, not the API address the
        // order carries, so the agent can be told to walk them to it.
        const recent = orders.orders
          .slice(0, 5)
          .map(
            (order) =>
              `${order.title} — ${money(order.totalCents, order.currency)} on ${shortDate(order.createdAt)}, receipt at /account/purchases/${order.id}/receipt`,
          )
          .join("; ");
        lines.push(`Recent purchases: ${recent}`);
      }

      if (certificates?.certificates.some((cert) => !cert.revoked)) {
        const earned = certificates.certificates
          .filter((cert) => !cert.revoked)
          .slice(0, 4)
          .map((cert) => `${cert.courseTitle} — ${cert.creditHours}, issued ${shortDate(cert.issuedAt)}`)
          .join("; ");
        lines.push(`Certificates: ${earned}. They are on /account (their certificates section).`);
      }

      if (coaching?.upcoming?.length) {
        const next = coaching.upcoming
          .slice(0, 3)
          .map((session) => `${session.offerTitle} — ${session.label || shortDate(session.startsAt)}`)
          .join("; ");
        lines.push(`Coaching booked: ${next}. Their bookings live on /coaching.`);
      }

      lines.push(
        ctx.mode === "voice"
          ? "Answer only what they asked, in one or two sentences, with the real figures above — then offer to take them to the page it lives on."
          : "Answer only what they asked, briefly, with the real figures above — then offer to open the page it lives on.",
      );
      return lines.join("\n");
    },
  }) as ConciergeTool;
}

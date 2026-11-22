import { GlassCard } from "@/components/luxe/GlassCard";
import { KajabiForm } from "@/pages/kajabi/pages/shared";
import {
  CONTINUATION_MESSAGE,
  LOUNGE_TERMS_LINE,
  VIP_WAITLIST_FORM_SLUG,
  tierIdFor,
  tierMessage,
  type LoungeSeatPricing,
} from "@/content/loungePricing";

/**
 * Lounge checkout messaging (Yvette, 22 Nov 2026, item 1): which price phase is
 * on sale for this tier, from the server's paid-seat count. The prices
 * themselves are the server's options; this only explains them.
 */
export function LoungeSeatNotice({ slug, seatPricing }: { slug: string; seatPricing: LoungeSeatPricing }) {
  const tier = tierIdFor(slug);
  if (!tier) return null;
  // Her checkout line: the tier's block, then the shared terms sentence (migration 222).
  const text = seatPricing.continuation ? CONTINUATION_MESSAGE : `${tierMessage(tier, seatPricing)} ${LOUNGE_TERMS_LINE}`;
  return (
    <GlassCard accent={tier === "vip" ? "gold" : "plum"} interactive={false} className="mx-auto max-w-5xl p-4 sm:p-5">
      <p role="note" data-lounge-phase={seatPricing.viewerPhase} className="text-pretty text-sm leading-relaxed text-white">
        {text}
      </p>
    </GlassCard>
  );
}

/** In place of the VIP checkout while all six VIP seats are filled. */
export function LoungeVipWaitlist({ seatPricing }: { seatPricing: LoungeSeatPricing }) {
  return (
    <GlassCard accent="gold" interactive={false} className="mx-auto max-w-xl px-6 py-10 sm:px-10">
      <h1 className="text-center font-display text-[1.8rem] leading-tight text-white">Join the VIP waitlist</h1>
      <p className="copy-luxe mt-4 text-pretty text-center">{tierMessage("vip", seatPricing)}</p>
      <KajabiForm
        formSlug={VIP_WAITLIST_FORM_SLUG}
        fields={[
          { key: "first_name", label: "First Name", type: "text", required: true, autoComplete: "given-name", half: true },
          { key: "last_name", label: "Last Name", type: "text", autoComplete: "family-name", half: true },
          { key: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
        ]}
        submitLabel="JOIN THE VIP WAITLIST"
        successMessage="You’re on the VIP waitlist. We’ll email you when a VIP seat becomes available."
        className="mt-8"
      />
    </GlassCard>
  );
}

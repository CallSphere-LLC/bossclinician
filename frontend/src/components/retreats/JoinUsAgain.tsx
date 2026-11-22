import type { OfferCardView } from "@/lib/retreatsApi";
import { safeHref } from "@/lib/safeHref";
import { BUTTON_OUTLINE, BUTTON_PRIMARY } from "./retreatUi";

/**
 * "Join Us Again" — only the cards the owner has configured and made visible.
 * Nothing here invents a destination, a date or a price: an unannounced retreat
 * is an interest list, not a checkout.
 */
export function JoinUsAgain({ intro, cards, readOnly }: { intro: string; cards: OfferCardView[]; readOnly: boolean }) {
  const toInterest = () => {
    const target = document.getElementById("interest");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  };

  return (
    <div className="flex flex-col gap-5">
      {intro && <p>{intro}</p>}
      {cards.length === 0 ? (
        <p className="text-orchid-dim">Nothing new to share just yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => {
            const href = card.ctaUrl ? safeHref(card.ctaUrl) : null;
            return (
              <li key={card.id} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-night-raised">
                {card.imageUrl && <img src={card.imageUrl} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />}
                <div className="flex flex-1 flex-col gap-2 p-5">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-gold">
                    {card.kind === "international" ? "International retreat" : "Domestic business retreat"}
                  </p>
                  <h3 className="font-display text-lg text-white">{card.title}</h3>
                  {(card.destination || card.datesText) && (
                    <p className="text-sm text-white/80">{[card.destination, card.datesText].filter(Boolean).join(" · ")}</p>
                  )}
                  {card.description && <p className="whitespace-pre-wrap text-sm">{card.description}</p>}
                  <div className="mt-auto pt-3">
                    {card.booked ? (
                      <p className="font-semibold text-emerald-200">You're booked</p>
                    ) : card.status === "sold_out" ? (
                      <p className="font-semibold text-orchid-dim">Sold out</p>
                    ) : card.status === "registration_open" && href ? (
                      <a href={href} className={BUTTON_PRIMARY} aria-disabled={readOnly}>
                        {card.ctaLabel || "Explore this retreat"}
                      </a>
                    ) : card.status === "interest_list" ? (
                      href ? (
                        <a href={href} className={BUTTON_OUTLINE}>
                          {card.ctaLabel || "Get first access"}
                        </a>
                      ) : (
                        <button type="button" className={BUTTON_OUTLINE} onClick={toInterest}>
                          {card.ctaLabel || "Get first access"}
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

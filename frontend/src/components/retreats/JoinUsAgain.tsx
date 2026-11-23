import type { OfferCardView } from "@/lib/retreatsApi";
import { safeHref } from "@/lib/safeHref";
import { BUTTON_OUTLINE, BUTTON_PRIMARY } from "./retreatUi";

/**
 * Default button on an "interest list" card. Not "first access": nothing is
 * offered before the public announcement (Yvette, 22 Nov 2026 round 2, item 6).
 */
export const INTEREST_LIST_LABEL = "Keep me posted on future retreats";

/** Yvette, 23 Nov 2026 (item 13): the button opens the general retreat-updates sign-up, not a Bali page. */
export const INTEREST_LIST_HREF = "/retreat-interest";

/**
 * "Join Us Again" — only the cards the owner has configured and made visible.
 * Nothing here invents a destination, a date or a price: an unannounced retreat
 * is an interest list, not a checkout.
 */
export function JoinUsAgain({ intro, cards, readOnly }: { intro: string; cards: OfferCardView[]; readOnly: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      {intro && <p>{intro}</p>}
      {cards.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-orchid-dim">Nothing new to share just yet.</p>
          <a href={INTEREST_LIST_HREF} className={BUTTON_OUTLINE}>
            {INTEREST_LIST_LABEL}
          </a>
        </div>
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
                          {card.ctaLabel || INTEREST_LIST_LABEL}
                        </a>
                      ) : (
                        <a href={INTEREST_LIST_HREF} className={BUTTON_OUTLINE}>
                          {card.ctaLabel || INTEREST_LIST_LABEL}
                        </a>
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

import { useEffect, useRef, useState } from "react";
import {
  commerceApi,
  commerceErrorMessage,
  type AppliedCoupon,
  type Quote,
  type QuoteInput,
} from "@/lib/commerceApi";

/**
 * Keeps the order summary in step with what the buyer has chosen.
 *
 * Every figure on the checkout page comes from `/quote`, which is the same
 * arithmetic the charge itself will run. Nothing is added up here: a coupon
 * toggled in the browser must not be able to change what is owed, and a total
 * assembled locally would eventually disagree with the one Stripe is handed.
 *
 * Typing is debounced, ticking a bump is not — a checkbox that takes 400ms to
 * change the total reads as broken, while a coupon field that fires per keystroke
 * is a code-guessing oracle with a progress bar.
 */

export interface TaxAddress {
  country?: string;
  state?: string;
  postalCode?: string;
}

export interface QuoteSelections {
  couponCode: string;
  bumpProductIds: number[];
  /** Set only for a pay-what-you-want offer. The server enforces the floor. */
  pwywAmountCents?: number;
  /** Sent only when the offer collects tax; the rate is the server's decision. */
  taxAddress?: TaxAddress;
}

export interface QuoteState {
  quote: Quote;
  coupon: AppliedCoupon | null;
  /** Why a typed code did not apply, in words the buyer can act on. */
  couponError: string | null;
  /** True while a re-quote is in flight, so the summary can settle rather than flicker. */
  pending: boolean;
  /** Set when the quote call itself failed; the last good figures stay on screen. */
  error: string | null;
}

const DEBOUNCE_MS = 400;

function buildRequest(selections: QuoteSelections): QuoteInput {
  const request: QuoteInput = {};

  const code = selections.couponCode.trim();
  if (code !== "") request.couponCode = code;

  if (selections.bumpProductIds.length > 0) {
    request.bumpProductIds = [...selections.bumpProductIds].sort((a, b) => a - b);
  }

  if (selections.pwywAmountCents !== undefined) {
    request.pwywAmountCents = selections.pwywAmountCents;
  }

  const address = selections.taxAddress;
  if (address && (address.country || address.state || address.postalCode)) {
    request.address = {
      ...(address.country ? { country: address.country } : {}),
      ...(address.state ? { state: address.state } : {}),
      ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    };
  }

  return request;
}

export function useOfferQuote(
  slug: string,
  listPrice: Quote,
  selections: QuoteSelections
): QuoteState {
  const [state, setState] = useState<QuoteState>({
    quote: listPrice,
    coupon: null,
    couponError: null,
    pending: false,
    error: null,
  });

  const request = buildRequest(selections);
  // Only the serialised form drives the effect; the object itself is new on every
  // render and would restart the debounce on an unrelated keystroke.
  const requestRef = useRef(request);
  requestRef.current = request;

  const typedKey = JSON.stringify([
    request.couponCode ?? "",
    request.pwywAmountCents ?? null,
    request.address ?? null,
  ]);
  const bumpKey = JSON.stringify(request.bumpProductIds ?? []);
  const previousTypedKey = useRef(typedKey);

  useEffect(() => {
    const isTyping = typedKey !== previousTypedKey.current;
    previousTypedKey.current = typedKey;

    // Nothing has been chosen, so the offer's own list price is already the
    // answer. Reverting locally is what makes clearing a coupon feel instant.
    if (Object.keys(requestRef.current).length === 0) {
      setState({
        quote: listPrice,
        coupon: null,
        couponError: null,
        pending: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, pending: true }));

    const timer = window.setTimeout(() => {
      commerceApi
        .quote(slug, requestRef.current)
        .then((result) => {
          if (cancelled) return;
          setState({
            quote: result,
            coupon: result.coupon,
            couponError: result.couponError,
            pending: false,
            error: null,
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            pending: false,
            error: commerceErrorMessage(err, "We couldn't refresh your total just now."),
          }));
        });
    }, isTyping ? DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug, typedKey, bumpKey, listPrice]);

  return state;
}

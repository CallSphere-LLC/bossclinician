import { formatMoney } from "../services/pricing";

/**
 * Money for display, on a surface that has to render whatever the row holds.
 *
 * `formatMoney` goes through `Intl.NumberFormat`, which throws a RangeError on a
 * currency code it cannot parse. The offer editor only accepts a code from a
 * known list, so this is the second line rather than the first — but a row
 * written before that rule, or by hand, or by an import, would otherwise take
 * down whatever is rendering it. On a receipt that matters twice over: the
 * template runs after the payment has been recorded, so a throw there fails the
 * webhook handler over a three-letter typo rather than over anything to do with
 * the money.
 *
 * The fallback prints the code beside the amount instead of substituting a
 * currency of our choosing: a page that quietly renders an unknown code as
 * dollars is worse than one that admits it does not know the symbol.
 */
export function formatAmount(cents: number, currency: string): string {
  const code = currency || "usd";
  try {
    return formatMoney(cents, code);
  } catch {
    return `${code.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

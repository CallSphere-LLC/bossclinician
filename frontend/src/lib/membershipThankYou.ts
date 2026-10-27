/** Only verified paid receipts for these offers may leave the receipt page.
 * Never carry the receipt token, query string or a third-party destination.
 */
export function membershipThankYouDestination(receipt: {
  status: string;
  offerSlug: string | null;
  redirectUrl: string | null;
}): string | null {
  if (receipt.status !== "paid") return null;
  const destination = receipt.offerSlug === "the-club" ? "/the-club-ty"
    : receipt.offerSlug === "the-lounge" || receipt.offerSlug === "the-lounge-vip"
      ? "/lounge-confirmed" : null;
  return destination && receipt.redirectUrl === destination ? destination : null;
}

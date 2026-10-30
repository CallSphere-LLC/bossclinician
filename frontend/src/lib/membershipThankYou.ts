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
      ? "/lounge-confirmed"
      // A payment that left the page and came back (a bank or wallet redirect)
      // lands on the receipt; these buyers' intake button is on this page.
      : receipt.offerSlug?.startsWith("credential-for-you-")
        ? "/credentialing-next-steps" : null;
  return destination && receipt.redirectUrl === destination ? destination : null;
}

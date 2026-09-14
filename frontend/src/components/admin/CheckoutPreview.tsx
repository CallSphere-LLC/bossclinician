import { checkoutButtonStyle } from "@/components/checkout/checkoutStyle";
export function CheckoutPreview({ settings }: { settings: Record<string, unknown> }) {
  return <div aria-label="Live cart and checkout preview" className="grid min-w-0 gap-4 xl:grid-cols-2">
    {["Cart", "Checkout"].map((title) => <section key={title} className="min-w-0 rounded-xl border border-hairline bg-night-deep p-4">
      <h3 className="font-semibold text-ink">{title} preview</h3>
      <p className="mt-1 text-xs text-ink-soft">Sample product · $47.00</p>
      {title === "Checkout" && <div className="my-4 rounded-lg border border-hairline p-3 text-xs text-ink-soft">Email address<br/><br/>Payment details</div>}
      {settings.showCoupons !== false && <div className="my-3 rounded-lg border border-hairline p-2 text-xs text-ink-soft">Discount code</div>}
      <p className="my-4 flex justify-between text-sm"><span>Total</span><span>$47.00</span></p>
      <button type="button" tabIndex={-1} aria-disabled="true" className="w-full px-4 py-3 font-semibold" style={checkoutButtonStyle(settings)}>{title === "Cart" ? "Continue to checkout" : "Pay $47.00"}</button>
      {settings.termsUrl ? <p className="mt-3 text-xs text-ink-soft">Terms and conditions</p> : null}
      {settings.supportEmail ? <p className="mt-3 break-all text-xs text-ink-soft">Questions? {String(settings.supportEmail)}</p> : null}
    </section>)}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { writeCart } from '@/lib/cart';
import { commerceApi, commerceErrorMessage } from '@/lib/commerceApi';
import { rememberReceipt, successPath } from '@/components/checkout/receipt';
import { CheckoutShell } from './Checkout';

/**
 * `/checkout/paypal/return` — where PayPal sends the buyer back.
 *
 * One page for both PayPal flows. A one-time payment comes back with
 * `token` (PayPal's order id) and is captured here; a membership or payment
 * plan comes back with `subscription_id` and is confirmed once PayPal has
 * taken the first payment (or straight away for a free trial). Either way the
 * receipt proof lives in this tab's sessionStorage — it never went to PayPal.
 *
 * If PayPal is still finishing the first payment the page checks again for a
 * short while; the webhook completes the order regardless, so leaving early
 * loses nothing.
 */

interface SavedCheckout {
  orderToken: string;
  offerSlug: string;
  kind?: 'order' | 'subscription';
  redirectUrl?: string | null;
  isCart?: boolean;
}

type View =
  | { state: 'working'; message: string }
  | { state: 'pending' }
  | { state: 'cancelled'; offerSlug: string }
  | { state: 'error'; message: string; retry: boolean };

const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function PayPalReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ state: 'working', message: 'Confirming your PayPal payment…' });
  const started = useRef(false);
  const orderId = Number(params.get('orderId'));
  const subscriptionId = params.get('subscription_id') ?? '';
  const paypalOrderId = params.get('token') ?? '';
  const cancelled = params.get('cancelled') === '1';

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    async function complete() {
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        setView({ state: 'error', message: 'This return link is incomplete. Please contact support before trying to pay again.', retry: false });
        return;
      }
      let saved: SavedCheckout;
      try {
        const raw = sessionStorage.getItem(`bc-paypal-order-${orderId}`);
        if (!raw) throw new Error('Missing checkout session');
        saved = JSON.parse(raw) as SavedCheckout;
        if (!saved.orderToken || !saved.offerSlug) throw new Error('Invalid checkout session');
      } catch {
        setView({
          state: 'error',
          message: 'We could not restore your checkout in this browser tab. If PayPal took a payment, your access will arrive by email within a few minutes — please contact support before paying again.',
          retry: false,
        });
        return;
      }
      const forget = () => {
        try { sessionStorage.removeItem(`bc-paypal-order-${orderId}`); } catch { /* storage blocked: nothing to clear */ }
      };
      const finish = () => {
        const receipt = { orderId, orderToken: saved.orderToken };
        rememberReceipt(saved.offerSlug, receipt);
        forget();
        if (saved.isCart) {
          try { writeCart([]); } catch { /* the cart page reconciles against what they own */ }
        }
        // Like the card checkout: the offer's own thank-you destination wins.
        if (saved.redirectUrl) { window.location.assign(saved.redirectUrl); return; }
        navigate(successPath(receipt), { replace: true });
      };

      try {
        if (cancelled) {
          await commerceApi.cancelPayPal(orderId, saved.orderToken);
          forget();
          setView({ state: 'cancelled', offerSlug: saved.offerSlug });
          return;
        }

        const isSubscription = saved.kind === 'subscription' || subscriptionId !== '';
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
          let status: 'paid' | 'pending' | 'cancelled';
          if (isSubscription) {
            if (!subscriptionId) throw new Error('PayPal did not return a subscription reference.');
            status = (await commerceApi.confirmPayPalSubscription(orderId, saved.orderToken, subscriptionId)).status;
          } else {
            if (!paypalOrderId) throw new Error('PayPal did not return a payment reference.');
            status = (await commerceApi.capturePayPal(orderId, saved.orderToken, paypalOrderId)).status;
          }
          if (status === 'paid') { finish(); return; }
          if (status === 'cancelled') { forget(); setView({ state: 'cancelled', offerSlug: saved.offerSlug }); return; }
          setView({ state: 'working', message: 'PayPal is finishing your first payment…' });
          await wait(POLL_INTERVAL_MS);
        }
        setView({ state: 'pending' });
      } catch (e) {
        setView({ state: 'error', message: commerceErrorMessage(e, 'We could not confirm the PayPal payment. Please retry, or contact support before paying again.'), retry: true });
      }
    }
    void complete();
  }, [cancelled, navigate, orderId, paypalOrderId, subscriptionId]);

  return (
    <CheckoutShell>
      <div className="mx-auto max-w-xl rounded-2xl border border-white/15 bg-white/5 p-8 text-white">
        {view.state === 'working' && (
          <div role="status" aria-live="polite" className="flex items-center gap-3">
            <Loader2 aria-hidden className="size-5 animate-spin text-gold" />
            {view.message}
          </div>
        )}
        {view.state === 'pending' && (
          <div role="status">
            <div className="flex items-start gap-3">
              <CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0 text-gold" />
              <p>PayPal has your approval and is still processing the first payment. You don&rsquo;t need to do anything else: your receipt and access will arrive by email as soon as it clears.</p>
            </div>
            <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-gold px-5 py-3 font-semibold text-night-deep">Check again</button>
          </div>
        )}
        {view.state === 'cancelled' && (
          <div role="alert">
            <div className="flex items-start gap-3">
              <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-gold" />
              <p>PayPal checkout was cancelled. No payment was taken.</p>
            </div>
            <Link to={`/checkout/${encodeURIComponent(view.offerSlug)}`} className="mt-6 inline-block rounded-xl bg-gold px-5 py-3 font-semibold text-night-deep">Back to checkout</Link>
          </div>
        )}
        {view.state === 'error' && (
          <div role="alert">
            <div className="flex items-start gap-3">
              <AlertCircle aria-hidden className="mt-1 size-5 shrink-0 text-gold" />
              <p>{view.message}</p>
            </div>
            {view.retry && (
              <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-gold px-5 py-3 font-semibold text-night-deep">Retry confirmation</button>
            )}
          </div>
        )}
        {view.state !== 'working' && (
          <Link to="/contact" className="mt-6 inline-block text-sm text-gold underline underline-offset-4">Contact support</Link>
        )}
      </div>
    </CheckoutShell>
  );
}

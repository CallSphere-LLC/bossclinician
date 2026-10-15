import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, Loader2 } from 'lucide-react';
import { commerceApi, commerceErrorMessage } from '@/lib/commerceApi';
import { rememberReceipt, successPath } from '@/components/checkout/receipt';
import { CheckoutShell } from './Checkout';

/** The browser returns from PayPal with its provider order ID. The receipt proof
 * stays in sessionStorage and never goes to PayPal in a redirect URL. */
export default function PayPalReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error,setError] = useState('');
  const [working,setWorking] = useState(true);
  const started = useRef(false);
  const orderId = Number(params.get('orderId'));
  const paypalOrderId = params.get('token') ?? '';
  const cancelled = params.get('cancelled') === '1';
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    async function complete() {
      if (!Number.isSafeInteger(orderId) || orderId <= 0) { setError('This return link is incomplete. Please contact support.'); setWorking(false); return; }
      let saved: {orderToken:string;offerSlug:string};
      try {
        const raw = sessionStorage.getItem(`bc-paypal-order-${orderId}`);
        if (!raw) throw new Error('Missing checkout session');
        saved = JSON.parse(raw) as typeof saved;
        if (!saved.orderToken || !saved.offerSlug) throw new Error('Invalid checkout session');
      } catch { setError('Your checkout session could not be restored. Please contact support before trying to pay again.'); setWorking(false); return; }
      try {
        if (cancelled) {
          await commerceApi.cancelPayPal(orderId,saved.orderToken);
          sessionStorage.removeItem(`bc-paypal-order-${orderId}`);
          setError('PayPal checkout was cancelled. No payment was captured.');
          setWorking(false);
          return;
        }
        if (!paypalOrderId) throw new Error('PayPal did not return an order ID.');
        await commerceApi.capturePayPal(orderId,saved.orderToken,paypalOrderId);
        const receipt = {orderId,orderToken:saved.orderToken};
        rememberReceipt(saved.offerSlug,receipt);
        sessionStorage.removeItem(`bc-paypal-order-${orderId}`);
        navigate(successPath(receipt),{replace:true});
      } catch(e) { setError(commerceErrorMessage(e,'We could not confirm the PayPal payment. Please retry confirmation or contact support.')); setWorking(false); }
    }
    void complete();
  },[cancelled,navigate,orderId,paypalOrderId]);
  return <CheckoutShell><div className="mx-auto max-w-xl rounded-2xl border border-white/15 bg-white/5 p-8 text-white">
    {working?<div role="status" className="flex items-center gap-3"><Loader2 className="size-5 animate-spin text-gold"/>Confirming your PayPal payment…</div>:<>
      <div role="alert" className="flex items-start gap-3"><AlertCircle className="mt-1 size-5 shrink-0 text-gold"/><p>{error}</p></div>
      {!cancelled && <button type="button" onClick={()=>window.location.reload()} className="mt-6 rounded-xl bg-gold px-5 py-3 font-semibold text-night-deep">Retry confirmation</button>}
      <Link to="/courses" className="mt-6 ml-4 inline-block text-gold underline">Browse courses</Link>
    </>}
  </div></CheckoutShell>;
}

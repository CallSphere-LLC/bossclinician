/** PayPal Orders v2 sandbox adapter. Deliberately off until a sandbox app and
 * explicit checkout flag are configured; no live credential is accepted here. */
export const paypalSandboxReady = (): boolean =>
  process.env.PAYPAL_CHECKOUT_ENABLED === 'true' &&
  process.env.PAYPAL_ENVIRONMENT === 'sandbox' &&
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

const API = 'https://api-m.sandbox.paypal.com';

export interface PayPalCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  custom_id?: string;
}
export interface PayPalOrder {
  id: string;
  status: string;
  links?: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: { captures?: PayPalCapture[] };
  }>;
}

async function accessToken(): Promise<string> {
  if (!paypalSandboxReady()) throw new Error('PayPal sandbox checkout is not configured');
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`PayPal authentication failed (${response.status})`);
  const value = await response.json() as { access_token?: string };
  if (!value.access_token) throw new Error('PayPal access token is missing');
  return value.access_token;
}

async function request<T>(path: string, method: 'GET'|'POST', body?: unknown, requestId?: string): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`PayPal request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function centsToUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Invalid PayPal amount');
  return (cents / 100).toFixed(2);
}

export async function createPayPalOrder(input: { orderId: number; amountCents: number; title: string; returnUrl: string; cancelUrl: string }): Promise<{ id: string; approveUrl: string }> {
  const order = await request<PayPalOrder>('/v2/checkout/orders', 'POST', {
    intent: 'CAPTURE',
    purchase_units: [{ reference_id: String(input.orderId), custom_id: String(input.orderId), description: input.title.slice(0,127), amount: { currency_code: 'USD', value: centsToUsd(input.amountCents) } }],
    payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', return_url: input.returnUrl, cancel_url: input.cancelUrl } } },
  }, `boss-offer-${input.orderId}`);
  const approval = order.links?.find(link => link.rel === 'payer-action' || link.rel === 'approve')?.href;
  if (!order.id || !approval) throw new Error('PayPal approval link is missing');
  const url = new URL(approval);
  if (url.protocol !== 'https:' || url.hostname !== 'www.sandbox.paypal.com') throw new Error('Unexpected PayPal approval URL');
  return { id: order.id, approveUrl: approval };
}

export const getPayPalOrder = (id: string): Promise<PayPalOrder> => request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}`, 'GET');
export const capturePayPalOrder = (id: string): Promise<PayPalOrder> => request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, 'POST', {}, `boss-capture-${id}`);

export function completedCapture(order: PayPalOrder, expected: { orderId: number; amountCents: number }): PayPalCapture | null {
  if (order.status !== 'COMPLETED' || !order.purchase_units || order.purchase_units.length !== 1) return null;
  const unit = order.purchase_units[0];
  const captures = unit.payments?.captures ?? [];
  if (unit.custom_id !== String(expected.orderId) || captures.length !== 1) return null;
  const capture = captures[0];
  if (capture.status !== 'COMPLETED' || capture.custom_id && capture.custom_id !== String(expected.orderId)) return null;
  if (capture.amount.currency_code !== 'USD' || capture.amount.value !== centsToUsd(expected.amountCents)) return null;
  return capture;
}

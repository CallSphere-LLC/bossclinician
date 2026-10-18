/**
 * PayPal REST adapter: Orders v2 (one-time), Catalog Products, Billing Plans
 * and Subscriptions v1 (memberships and fixed-installment plans), and webhook
 * signature verification.
 *
 * Configuration comes straight from the environment and is read on every call,
 * so the button appears or disappears with backend/.env and nothing else:
 *
 *   PAYPAL_CHECKOUT_ENABLED=true        the release switch
 *   PAYPAL_ENVIRONMENT=sandbox|live     which PayPal the keys belong to
 *   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET   the REST app's credentials
 *   PAYPAL_WEBHOOK_ID                   the webhook the app registered
 *   PAYPAL_MERCHANT_ID                  optional; the payee on one-time orders
 *
 * The webhook id is required for "enabled", not just for the webhook route:
 * renewals, refunds and cancellations only ever reach us through it, and a
 * recurring checkout that cannot hear its own renewals must not be offered.
 */

export type PayPalEnvironment = "sandbox" | "live";

export interface PayPalConfig {
  environment: PayPalEnvironment;
  clientId: string;
  clientSecret: string;
  webhookId: string;
  merchantId: string;
  apiBase: string;
  /** The only host an approval link may point at. */
  approvalHost: string;
}

const API_BASE: Record<PayPalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};
const APPROVAL_HOST: Record<PayPalEnvironment, string> = {
  sandbox: "www.sandbox.paypal.com",
  live: "www.paypal.com",
};

/** The configured environment, or null when the value is missing or misspelt. */
export function paypalEnvironment(): PayPalEnvironment | null {
  const raw = (process.env.PAYPAL_ENVIRONMENT ?? "").trim().toLowerCase();
  return raw === "sandbox" || raw === "live" ? raw : null;
}

/** Everything needed to call PayPal, or null when anything is missing. */
export function paypalConfig(): PayPalConfig | null {
  const environment = paypalEnvironment();
  const clientId = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  if (!environment || !clientId || !clientSecret) return null;
  return {
    environment,
    clientId,
    clientSecret,
    webhookId: (process.env.PAYPAL_WEBHOOK_ID ?? "").trim(),
    merchantId: (process.env.PAYPAL_MERCHANT_ID ?? "").trim(),
    apiBase: API_BASE[environment],
    approvalHost: APPROVAL_HOST[environment],
  };
}

/**
 * Whether customers may be offered PayPal. Explicit switch, valid environment,
 * credentials and the webhook id, all four.
 */
export function paypalEnabled(): boolean {
  const config = paypalConfig();
  return process.env.PAYPAL_CHECKOUT_ENABLED === "true" && config !== null && config.webhookId !== "";
}

/** What the admin may see: configured or not, which environment, never a secret. */
export function paypalStatus(): {
  enabled: boolean;
  environment: PayPalEnvironment | null;
  credentials: boolean;
  webhook: boolean;
  merchantId: string;
} {
  const config = paypalConfig();
  return {
    enabled: paypalEnabled(),
    environment: paypalEnvironment(),
    credentials: config !== null,
    webhook: Boolean((process.env.PAYPAL_WEBHOOK_ID ?? "").trim()),
    merchantId: (process.env.PAYPAL_MERCHANT_ID ?? "").trim(),
  };
}

/** A failed PayPal call. `debugId` is what PayPal support asks for. */
export class PayPalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue: string,
    readonly debugId: string,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
}

/* ------------------------------------------------------------ OAuth token */

interface CachedToken {
  key: string;
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let inflightToken: { key: string; promise: Promise<string> } | null = null;

/** Refresh this long before PayPal's stated expiry, so a token never dies mid-request. */
const TOKEN_EARLY_REFRESH_MS = 60_000;

/** Test hook: forget the cached token. */
export function resetPayPalTokenCache(): void {
  cachedToken = null;
  inflightToken = null;
}

async function fetchToken(config: PayPalConfig): Promise<CachedToken> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new PayPalApiError(`PayPal authentication failed (${response.status})`, response.status, "AUTHENTICATION_FAILURE", response.headers.get("paypal-debug-id") ?? "");
  const value = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!value.access_token) throw new PayPalApiError("PayPal access token is missing", 502, "NO_TOKEN", "");
  const lifetimeMs = Math.max(0, (Number(value.expires_in) || 0) * 1000 - TOKEN_EARLY_REFRESH_MS);
  return { key: tokenKey(config), token: value.access_token, expiresAt: Date.now() + lifetimeMs };
}

/** A token belongs to one app in one environment; switching either invalidates it. */
function tokenKey(config: PayPalConfig): string {
  return `${config.environment}:${config.clientId}`;
}

/**
 * A cached access token until shortly before it expires. Concurrent callers
 * share one in-flight request rather than each minting their own.
 */
export async function paypalAccessToken(config: PayPalConfig): Promise<string> {
  const key = tokenKey(config);
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (inflightToken && inflightToken.key === key) return inflightToken.promise;
  const promise = fetchToken(config)
    .then((fresh) => {
      cachedToken = fresh;
      return fresh.token;
    })
    .finally(() => {
      if (inflightToken?.promise === promise) inflightToken = null;
    });
  inflightToken = { key, promise };
  return promise;
}

/* --------------------------------------------------------------- requests */

function requireConfig(): PayPalConfig {
  const config = paypalConfig();
  if (!config) throw new PayPalApiError("PayPal is not configured", 503, "NOT_CONFIGURED", "");
  return config;
}

async function readError(response: Response): Promise<PayPalApiError> {
  let issue = "";
  let detail = "";
  try {
    const body = (await response.json()) as { name?: string; message?: string; details?: Array<{ issue?: string; description?: string }> };
    issue = body.details?.[0]?.issue ?? body.name ?? "";
    detail = body.details?.[0]?.description ?? body.message ?? "";
  } catch {
    // Not JSON; the status says enough.
  }
  return new PayPalApiError(
    `PayPal request failed (${response.status}${issue ? ` ${issue}` : ""})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    response.status,
    issue,
    response.headers.get("paypal-debug-id") ?? "",
  );
}

/**
 * One PayPal REST call. `requestId` becomes PayPal-Request-Id, PayPal's
 * idempotency key: a retried create or capture returns the first result instead
 * of doing it twice. A 401 means the cached token was revoked early; it is
 * dropped and the call made once more with a fresh one.
 */
export async function paypalRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  requestId?: string,
): Promise<T> {
  const config = requireConfig();
  for (let attempt = 0; ; attempt += 1) {
    const token = await paypalAccessToken(config);
    const response = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 && attempt === 0) {
      cachedToken = null;
      continue;
    }
    if (!response.ok) throw await readError(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/* ------------------------------------------------------------------ money */

/** Whole cents to PayPal's decimal string. Refuses anything not a positive integer. */
export function centsToUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Invalid PayPal amount");
  return (cents / 100).toFixed(2);
}

/** PayPal's decimal string to whole cents, or null when it is not a money value. */
export function usdToCents(value: string | undefined | null): number | null {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function assertApprovalUrl(href: string | undefined, config: PayPalConfig): string {
  if (!href) throw new Error("PayPal approval link is missing");
  const url = new URL(href);
  if (url.protocol !== "https:" || url.hostname !== config.approvalHost) throw new Error("Unexpected PayPal approval URL");
  return href;
}

/* ------------------------------------------------------- Orders v2 (one-time) */

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

export async function createPayPalOrder(input: {
  orderId: number;
  amountCents: number;
  title: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}): Promise<{ id: string; approveUrl: string }> {
  const config = requireConfig();
  const order = await paypalRequest<PayPalOrder>("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: String(input.orderId),
      custom_id: String(input.orderId),
      invoice_id: `BC-ORDER-${input.orderId}`,
      description: input.title.slice(0, 127),
      amount: { currency_code: "USD", value: centsToUsd(input.amountCents) },
      ...(config.merchantId ? { payee: { merchant_id: config.merchantId } } : {}),
    }],
    payment_source: {
      paypal: {
        experience_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          ...(input.brandName ? { brand_name: input.brandName.slice(0, 127) } : {}),
        },
      },
    },
  }, `boss-offer-${input.orderId}`);
  const approval = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!order.id) throw new Error("PayPal order id is missing");
  return { id: order.id, approveUrl: assertApprovalUrl(approval, config) };
}

export const getPayPalOrder = (id: string): Promise<PayPalOrder> =>
  paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}`, "GET");

export const capturePayPalOrder = (id: string): Promise<PayPalOrder> =>
  paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, "POST", {}, `boss-capture-${id}`);

/**
 * The one completed capture that pays exactly this order, or null. Amount,
 * currency and our order id must all match what the database says.
 */
export function completedCapture(order: PayPalOrder, expected: { orderId: number; amountCents: number }): PayPalCapture | null {
  if (order.status !== "COMPLETED" || !order.purchase_units || order.purchase_units.length !== 1) return null;
  const unit = order.purchase_units[0];
  const captures = unit.payments?.captures ?? [];
  if (unit.custom_id !== String(expected.orderId) || captures.length !== 1) return null;
  const capture = captures[0];
  if (capture.status !== "COMPLETED" || (capture.custom_id && capture.custom_id !== String(expected.orderId))) return null;
  if (capture.amount.currency_code !== "USD" || capture.amount.value !== centsToUsd(expected.amountCents)) return null;
  return capture;
}

/* ---------------------------------------- Catalog, plans and subscriptions */

export async function createPayPalProduct(input: { offerId: number; name: string; description?: string }): Promise<string> {
  const product = await paypalRequest<{ id: string }>("/v1/catalogs/products", "POST", {
    name: input.name.slice(0, 127) || `Offer ${input.offerId}`,
    ...(input.description ? { description: input.description.slice(0, 256) } : {}),
    type: "DIGITAL",
  }, `boss-product-${paypalEnvironment()}-${input.offerId}`);
  if (!product?.id) throw new Error("PayPal product id is missing");
  return product.id;
}

export interface PayPalBillingCycle {
  frequency: { interval_unit: "DAY" | "WEEK" | "MONTH" | "YEAR"; interval_count: number };
  tenure_type: "TRIAL" | "REGULAR";
  sequence: number;
  total_cycles: number;
  pricing_scheme?: { fixed_price: { currency_code: "USD"; value: string } };
}

export interface PayPalPlanBody {
  product_id: string;
  name: string;
  description?: string;
  status: "ACTIVE";
  billing_cycles: PayPalBillingCycle[];
  payment_preferences: {
    auto_bill_outstanding: boolean;
    setup_fee?: { currency_code: "USD"; value: string };
    setup_fee_failure_action: "CANCEL" | "CONTINUE";
    payment_failure_threshold: number;
  };
}

export async function createPayPalPlan(body: PayPalPlanBody, requestId: string): Promise<string> {
  const plan = await paypalRequest<{ id: string }>("/v1/billing/plans", "POST", body, requestId);
  if (!plan?.id) throw new Error("PayPal plan id is missing");
  return plan.id;
}

export interface PayPalSubscription {
  id: string;
  status: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED" | string;
  plan_id?: string;
  custom_id?: string;
  start_time?: string;
  status_update_time?: string;
  subscriber?: { email_address?: string; name?: { given_name?: string; surname?: string }; payer_id?: string };
  billing_info?: {
    outstanding_balance?: { currency_code: string; value: string };
    cycle_executions?: Array<{ tenure_type: "TRIAL" | "REGULAR"; sequence: number; cycles_completed: number; cycles_remaining?: number; total_cycles?: number }>;
    last_payment?: { amount?: { currency_code: string; value: string }; time?: string };
    next_billing_time?: string;
    final_payment_time?: string;
    failed_payments_count?: number;
  };
  links?: Array<{ rel: string; href: string }>;
}

export async function createPayPalSubscription(input: {
  orderId: number;
  planId: string;
  email: string;
  name: string;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}): Promise<{ id: string; approveUrl: string }> {
  const config = requireConfig();
  const [givenName, ...rest] = input.name.trim().split(/\s+/);
  const subscription = await paypalRequest<PayPalSubscription>("/v1/billing/subscriptions", "POST", {
    plan_id: input.planId,
    custom_id: String(input.orderId),
    subscriber: {
      ...(input.email ? { email_address: input.email } : {}),
      ...(givenName ? { name: { given_name: givenName.slice(0, 140), ...(rest.length ? { surname: rest.join(" ").slice(0, 140) } : {}) } } : {}),
    },
    application_context: {
      shipping_preference: "NO_SHIPPING",
      user_action: "SUBSCRIBE_NOW",
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      ...(input.brandName ? { brand_name: input.brandName.slice(0, 127) } : {}),
    },
  }, `boss-subscription-${input.orderId}-${input.planId}`);
  const approval = subscription.links?.find((link) => link.rel === "approve")?.href;
  if (!subscription.id) throw new Error("PayPal subscription id is missing");
  return { id: subscription.id, approveUrl: assertApprovalUrl(approval, config) };
}

export const getPayPalSubscription = (id: string): Promise<PayPalSubscription> =>
  paypalRequest<PayPalSubscription>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`, "GET");

export const activatePayPalSubscription = (id: string, reason: string): Promise<void> =>
  paypalRequest<void>(`/v1/billing/subscriptions/${encodeURIComponent(id)}/activate`, "POST", { reason: reason.slice(0, 128) });

export const suspendPayPalSubscription = (id: string, reason: string): Promise<void> =>
  paypalRequest<void>(`/v1/billing/subscriptions/${encodeURIComponent(id)}/suspend`, "POST", { reason: reason.slice(0, 128) });

/** Stops all future billing at once; PayPal has no "at period end". */
export const cancelPayPalSubscription = (id: string, reason: string): Promise<void> =>
  paypalRequest<void>(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, "POST", { reason: reason.slice(0, 128) || "Cancelled by customer" });

export interface PayPalSubscriptionTransaction {
  id: string;
  status: string;
  time?: string;
  amount_with_breakdown?: { gross_amount?: { currency_code: string; value: string } };
}

/** The subscription's payments between two instants (PayPal requires both). */
export async function listPayPalSubscriptionTransactions(id: string, since: Date, until: Date = new Date(Date.now() + 60_000)): Promise<PayPalSubscriptionTransaction[]> {
  const query = new URLSearchParams({ start_time: since.toISOString(), end_time: until.toISOString() });
  const result = await paypalRequest<{ transactions?: PayPalSubscriptionTransaction[] }>(
    `/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?${query.toString()}`, "GET");
  return result?.transactions ?? [];
}

/* --------------------------------------------------------------- webhooks */

export const PAYPAL_SIGNATURE_HEADERS = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

/**
 * The request body for /v1/notifications/verify-webhook-signature.
 *
 * Built as a string so a raw request body can be embedded byte for byte: PayPal
 * verifies against the event as it sent it, and a parsed-and-reserialised copy
 * can differ (number formatting, escaped characters). When only the parsed
 * object is available it is serialised, which is what PayPal's own SDKs do.
 */
export function verificationRequestBody(
  headers: Record<string, string | string[] | undefined>,
  webhookId: string,
  event: string | object,
): string | null {
  const read = (name: string): string | null => {
    const value = headers[name];
    const single = Array.isArray(value) ? value[0] : value;
    return typeof single === "string" && single !== "" ? single : null;
  };
  const fields = {
    auth_algo: read(PAYPAL_SIGNATURE_HEADERS.authAlgo),
    cert_url: read(PAYPAL_SIGNATURE_HEADERS.certUrl),
    transmission_id: read(PAYPAL_SIGNATURE_HEADERS.transmissionId),
    transmission_sig: read(PAYPAL_SIGNATURE_HEADERS.transmissionSig),
    transmission_time: read(PAYPAL_SIGNATURE_HEADERS.transmissionTime),
  };
  if (!webhookId || Object.values(fields).some((value) => value === null)) return null;
  const eventJson = typeof event === "string" ? event : JSON.stringify(event);
  const prefix = JSON.stringify({ ...fields, webhook_id: webhookId });
  return `${prefix.slice(0, -1)},"webhook_event":${eventJson}}`;
}

/** True only when PayPal itself says this delivery is genuine. */
export async function verifyPayPalWebhook(
  headers: Record<string, string | string[] | undefined>,
  event: string | object,
): Promise<boolean> {
  const config = requireConfig();
  const body = verificationRequestBody(headers, config.webhookId, event);
  if (body === null) return false;
  const token = await paypalAccessToken(config);
  const response = await fetch(`${config.apiBase}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await readError(response);
  const result = (await response.json()) as { verification_status?: string };
  return result.verification_status === "SUCCESS";
}

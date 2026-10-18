import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  centsToUsd,
  completedCapture,
  createPayPalOrder,
  getPayPalSubscription,
  paypalConfig,
  paypalEnabled,
  paypalStatus,
  resetPayPalTokenCache,
  usdToCents,
  verificationRequestBody,
  verifyPayPalWebhook,
} from './paypalClient';

const KEYS = ['PAYPAL_CHECKOUT_ENABLED', 'PAYPAL_ENVIRONMENT', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_MERCHANT_ID'] as const;
const saved: Record<string, string | undefined> = {};

function configure(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

const FULL = {
  PAYPAL_CHECKOUT_ENABLED: 'true',
  PAYPAL_ENVIRONMENT: 'sandbox',
  PAYPAL_CLIENT_ID: 'client-id',
  PAYPAL_CLIENT_SECRET: 'client-secret',
  PAYPAL_WEBHOOK_ID: 'WH-123',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  resetPayPalTokenCache();
});
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PayPal configuration', () => {
  it('is off unless every piece is present', () => {
    configure({});
    expect(paypalEnabled()).toBe(false);
    configure({ ...FULL, PAYPAL_CHECKOUT_ENABLED: 'false' });
    expect(paypalEnabled()).toBe(false);
    configure({ ...FULL, PAYPAL_WEBHOOK_ID: '' });
    expect(paypalEnabled()).toBe(false);
    configure({ ...FULL, PAYPAL_ENVIRONMENT: 'production' });
    expect(paypalEnabled()).toBe(false);
    configure({ ...FULL, PAYPAL_CLIENT_SECRET: '' });
    expect(paypalEnabled()).toBe(false);
    configure(FULL);
    expect(paypalEnabled()).toBe(true);
  });

  it('selects the API host and approval host by environment', () => {
    configure(FULL);
    expect(paypalConfig()).toMatchObject({ apiBase: 'https://api-m.sandbox.paypal.com', approvalHost: 'www.sandbox.paypal.com' });
    configure({ ...FULL, PAYPAL_ENVIRONMENT: 'LIVE' });
    expect(paypalConfig()).toMatchObject({ environment: 'live', apiBase: 'https://api-m.paypal.com', approvalHost: 'www.paypal.com' });
  });

  it('reports status without secrets', () => {
    configure({ ...FULL, PAYPAL_MERCHANT_ID: 'RVHE6XW3M7452' });
    const status = paypalStatus();
    expect(status).toEqual({ enabled: true, environment: 'sandbox', credentials: true, webhook: true, merchantId: 'RVHE6XW3M7452' });
    expect(JSON.stringify(status)).not.toContain('client-secret');
  });
});

describe('PayPal money', () => {
  it('converts whole cents both ways and refuses anything else', () => {
    expect(centsToUsd(9700)).toBe('97.00');
    expect(centsToUsd(39705)).toBe('397.05');
    expect(() => centsToUsd(0)).toThrow();
    expect(() => centsToUsd(12.5)).toThrow();
    expect(usdToCents('397.00')).toBe(39700);
    expect(usdToCents('612.5')).toBe(61250);
    expect(usdToCents('12')).toBe(1200);
    expect(usdToCents('1.234')).toBeNull();
    expect(usdToCents(undefined)).toBeNull();
  });

  it('accepts only the capture that pays exactly this order', () => {
    const order = { id: 'PAYPAL-1', status: 'COMPLETED', purchase_units: [{ custom_id: '42', payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '97.00' } }] } }] };
    expect(completedCapture(order, { orderId: 42, amountCents: 9700 })?.id).toBe('CAPTURE-1');
    expect(completedCapture(order, { orderId: 42, amountCents: 9701 })).toBeNull();
    expect(completedCapture(order, { orderId: 43, amountCents: 9700 })).toBeNull();
  });
});

describe('PayPal OAuth token', () => {
  it('is cached until shortly before it expires, then refreshed', async () => {
    configure(FULL);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/oauth2/token')) return json({ access_token: `token-${fetchMock.mock.calls.length}`, expires_in: 3600 });
      return json({ id: 'I-ABCDEFG', status: 'ACTIVE' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getPayPalSubscription('I-ABCDEFG');
    await getPayPalSubscription('I-ABCDEFG');
    const tokenCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/oauth2/token')).length;
    expect(tokenCalls()).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    const auth = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(auth.Authorization).toBe(`Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);

    // 3600s lifetime, refreshed 60s early: at 59 minutes it is still good...
    vi.setSystemTime(new Date('2026-10-17T12:58:00Z'));
    await getPayPalSubscription('I-ABCDEFG');
    expect(tokenCalls()).toBe(1);
    // ...and past the early-refresh line it is replaced.
    vi.setSystemTime(new Date('2026-10-17T12:59:30Z'));
    await getPayPalSubscription('I-ABCDEFG');
    expect(tokenCalls()).toBe(2);
  });

  it('shares one token request between concurrent calls and retries once on 401', async () => {
    configure(FULL);
    let apiCalls = 0;
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 'token', expires_in: 3600 });
      apiCalls += 1;
      return apiCalls === 1 ? json({ name: 'AUTHENTICATION_FAILURE' }, 401) : json({ id: 'I-ABCDEFG', status: 'ACTIVE' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([getPayPalSubscription('I-ABCDEFG'), getPayPalSubscription('I-ABCDEFG')]);
    // One token for the pair, a second after the 401 dropped it.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/oauth2/token')).length).toBe(2);
  });
});

describe('PayPal orders', () => {
  it('creates a server-priced order with an idempotency key and the payee', async () => {
    configure({ ...FULL, PAYPAL_ENVIRONMENT: 'live', PAYPAL_MERCHANT_ID: 'RVHE6XW3M7452' });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/oauth2/token')) return json({ access_token: 'token', expires_in: 3600 });
      return json({ id: 'ORDER-1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=ORDER-1' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await createPayPalOrder({ orderId: 42, amountCents: 39700, title: 'The Club', returnUrl: 'https://x/r', cancelUrl: 'https://x/c' });
    expect(result).toEqual({ id: 'ORDER-1', approveUrl: 'https://www.paypal.com/checkoutnow?token=ORDER-1' });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api-m.paypal.com/v2/checkout/orders');
    expect((init.headers as Record<string, string>)['PayPal-Request-Id']).toBe('boss-offer-42');
    const body = JSON.parse(String(init.body));
    expect(body.purchase_units[0]).toMatchObject({ custom_id: '42', amount: { currency_code: 'USD', value: '397.00' }, payee: { merchant_id: 'RVHE6XW3M7452' } });
  });

  it('refuses an approval link on the wrong host', async () => {
    configure(FULL);
    vi.stubGlobal('fetch', vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/v1/oauth2/token')
      ? json({ access_token: 'token', expires_in: 3600 })
      : json({ id: 'ORDER-1', links: [{ rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=ORDER-1' }] })));
    // A live link while configured for sandbox.
    await expect(createPayPalOrder({ orderId: 1, amountCents: 100, title: 'x', returnUrl: 'https://x', cancelUrl: 'https://x' })).rejects.toThrow('Unexpected PayPal approval URL');
  });
});

describe('PayPal webhook verification', () => {
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.paypal.com/v1/notifications/certs/CERT',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig==',
    'paypal-transmission-time': '2026-10-17T12:00:00Z',
  };

  it('embeds the raw event byte for byte, and refuses missing headers', () => {
    const raw = '{"id":"WH-EVT-1","event_type":"PAYMENT.SALE.COMPLETED","resource":{"amount":{"total":"397.00"}}}';
    const body = verificationRequestBody(headers, 'WH-123', raw)!;
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({ auth_algo: 'SHA256withRSA', transmission_id: 'tx-1', webhook_id: 'WH-123', webhook_event: { id: 'WH-EVT-1' } });
    expect(verificationRequestBody({ ...headers, 'paypal-transmission-sig': undefined }, 'WH-123', raw)).toBeNull();
    expect(verificationRequestBody(headers, '', raw)).toBeNull();
  });

  it('asks PayPal and trusts only SUCCESS', async () => {
    configure(FULL);
    let verdict = 'SUCCESS';
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/v1/oauth2/token')
      ? json({ access_token: 'token', expires_in: 3600 })
      : json({ verification_status: verdict }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyPayPalWebhook(headers, { id: 'WH-EVT-1', event_type: 'X' })).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
    expect(JSON.parse(String(init.body))).toMatchObject({ webhook_id: 'WH-123', cert_url: headers['paypal-cert-url'], webhook_event: { id: 'WH-EVT-1' } });
    verdict = 'FAILURE';
    await expect(verifyPayPalWebhook(headers, { id: 'WH-EVT-1', event_type: 'X' })).resolves.toBe(false);
    await expect(verifyPayPalWebhook({}, { id: 'WH-EVT-1' })).resolves.toBe(false);
  });
});

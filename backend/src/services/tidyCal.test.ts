import { afterEach, expect, it, vi } from 'vitest';
import { createTidyCalBooking, tidyCalBookingType, tidyCalSlots, TidyCalError } from './tidyCal';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('matches a free active booking type by the imported TidyCal slug and duration', async () => {
  vi.stubEnv('TIDYCAL_API_TOKEN', 'test-token');
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [
    { id: 42, url_slug: 'alignwithyvette', duration_minutes: 15, disabled_at: null, price: 0 },
    { id: 43, url_slug: 'alignwithyvette', duration_minutes: 30, disabled_at: null, price: 0 },
  ] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await tidyCalBookingType('alignwithyvette', 15)).toBe(42);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
});

it('keeps only remotely available times and handles a slot conflict', async () => {
  vi.stubEnv('TIDYCAL_API_TOKEN', 'test-token');
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [
    { starts_at: '2026-10-20T10:00:00Z', available_bookings: 1 },
    { starts_at: '2026-10-20T10:30:00Z', available_bookings: 0 },
  ] }), { status: 200 })).mockResolvedValueOnce(new Response('{}', { status: 409 }));
  vi.stubGlobal('fetch', fetcher);
  const available = await tidyCalSlots(42, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
  expect(available).toEqual(new Set([new Date('2026-10-20T10:00:00Z').getTime()]));
  await expect(createTidyCalBooking(42, { startsAt: new Date('2026-10-20T10:00:00Z'), name: 'QA', email: 'qa@example.com', timezone: 'UTC' })).rejects.toMatchObject({ status: 409 } satisfies Partial<TidyCalError>);
});

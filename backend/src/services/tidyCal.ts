/** Server-only TidyCal REST client. Never exposes the personal token to a browser. */
const API = 'https://tidycal.com/api';
const TIMEOUT_MS = 10_000;

export class TidyCalError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function token(): string | null { return process.env.TIDYCAL_API_TOKEN?.trim() || null; }
export function tidyCalEnabled(): boolean { return token() !== null && process.env.TIDYCAL_SYNC_ENABLED === 'true'; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = token();
  if (!secret) throw new TidyCalError(503, 'TidyCal is not configured');
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TidyCalError(503, 'The booking calendar is temporarily unavailable');
  }
  if (!response.ok) {
    if (response.status === 409) throw new TidyCalError(409, 'That time has just been taken. Please pick another.');
    throw new TidyCalError(response.status, `TidyCal request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

/** TidyCal validates instants as `Y-m-d\TH:i:s\Z` and rejects the milliseconds Date#toISOString adds. */
export function tidyCalInstant(date: Date): string { return date.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** TidyCal returns `price` as a decimal string ("0.00"), not a number. */
type BookingType = { id: number; url_slug: string; duration_minutes: number; disabled_at: string | null; price: number | string };
let typesCache: { expires: number; data: BookingType[] } | null = null;
export async function tidyCalBookingType(legacySlug: string, durationMinutes: number): Promise<number> {
  if (!typesCache || typesCache.expires < Date.now()) {
    const data: BookingType[] = [];
    // TidyCal paginates the list. Stop once a page is shorter than its first page.
    let pageSize = 0;
    for (let page = 1; page <= 20; page++) {
      const result = await request<{ data: BookingType[] }>(`/booking-types?page=${page}`);
      const batch = Array.isArray(result.data) ? result.data : [];
      if (page === 1) pageSize = batch.length;
      data.push(...batch);
      if (!batch.length || batch.length < pageSize) break;
    }
    typesCache = { expires: Date.now() + 5 * 60_000, data };
  }
  const matches = typesCache.data.filter((t) => t.url_slug === legacySlug && t.duration_minutes === durationMinutes && !t.disabled_at && Number(t.price) === 0);
  if (matches.length !== 1) throw new TidyCalError(503, 'This call has not been matched to a TidyCal booking type');
  return matches[0].id;
}

export async function tidyCalSlots(typeId: number, from: Date, to: Date): Promise<Set<number>> {
  const query = new URLSearchParams({ starts_at: tidyCalInstant(from), ends_at: tidyCalInstant(to) });
  const result = await request<{ data: Array<{ starts_at: string; available_bookings: number }> }>(`/booking-types/${typeId}/timeslots?${query}`);
  return new Set((result.data || []).filter((slot) => slot.available_bookings > 0).map((slot) => new Date(slot.starts_at).getTime()).filter(Number.isFinite));
}

export async function createTidyCalBooking(typeId: number, input: { startsAt: Date; name: string; email: string; timezone: string }): Promise<number> {
  const result = await request<{ data: { id: number } }>(`/booking-types/${typeId}/bookings`, {
    method: 'POST', body: JSON.stringify({ starts_at: tidyCalInstant(input.startsAt), name: input.name, email: input.email, timezone: input.timezone }),
  });
  if (!Number.isSafeInteger(result.data?.id) || result.data.id <= 0) throw new TidyCalError(503, 'TidyCal did not confirm the booking');
  return result.data.id;
}

export async function cancelTidyCalBooking(bookingId: number, reason: string): Promise<void> {
  await request(`/bookings/${bookingId}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) });
}

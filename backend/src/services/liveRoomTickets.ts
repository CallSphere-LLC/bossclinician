import crypto from "crypto";

/**
 * Single-use tickets for the live room's signalling stream.
 *
 * `EventSource` cannot send an Authorization header, which leaves two ways to
 * authenticate a browser's SSE connection: put the member's access token in the
 * query string, or mint something specifically for this one stream. The first is
 * what most implementations do and it is why access tokens turn up in nginx
 * access logs, referrer headers and support screenshots.
 *
 * So the stream authenticates with a ticket instead: 32 random bytes, valid for
 * one minute, usable once, and bound to the member, the community and the exact
 * peer id it was minted for. Leaking one costs an attacker a signalling
 * connection to a room they were already entitled to enter, for sixty seconds,
 * if they get there before the browser does.
 *
 * In-process, like the room roster it accompanies — correct while compose runs
 * one backend, and to be replaced together with the bus if that ever changes.
 */

interface Ticket {
  memberId: number;
  communityId: number;
  peerId: string;
  expiresAt: number;
}

const TICKET_TTL_MS = 60_000;
const tickets = new Map<string, Ticket>();

/** Drops expired tickets. Cheap, and keeps an abandoned mint from lingering. */
function sweep(): void {
  const now = Date.now();
  for (const [key, ticket] of tickets) {
    if (ticket.expiresAt <= now) tickets.delete(key);
  }
}

export function mintLiveTicket(input: {
  memberId: number;
  communityId: number;
  peerId: string;
}): { ticket: string; expiresInSeconds: number } {
  sweep();
  const ticket = crypto.randomBytes(32).toString("base64url");
  tickets.set(ticket, { ...input, expiresAt: Date.now() + TICKET_TTL_MS });
  return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
}

/**
 * Spends a ticket, or returns null.
 *
 * Deleted on the first read whether or not it validates: a ticket that has been
 * offered once has been observed, and letting a second attempt use it would
 * make "single use" a comment rather than a property.
 */
export function spendLiveTicket(
  ticket: string,
  peerId: string
): { memberId: number; communityId: number } | null {
  sweep();
  const found = tickets.get(ticket);
  if (!found) return null;
  tickets.delete(ticket);
  if (found.expiresAt <= Date.now()) return null;
  // The peer id is bound so a stolen ticket cannot be replayed under a
  // different connection id and claim someone else's seat in the roster.
  if (found.peerId !== peerId) return null;
  return { memberId: found.memberId, communityId: found.communityId };
}

/** Test seam. */
export function __resetLiveTickets(): void {
  tickets.clear();
}

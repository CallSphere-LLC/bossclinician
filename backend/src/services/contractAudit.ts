import crypto from 'crypto';
import type { PoolClient } from 'pg';

export const DISCLOSURE_VERSION = '2026-10-15';
export const ELECTRONIC_CONSENT = 'I agree to receive, review, and sign this contract electronically. I can download and keep the PDF and the signing record, and I can ask Boss Clinician for a paper copy or withdraw consent for future contracts.';
export const SIGNING_INTENT = 'I have reviewed the complete contract, and by typing my full name and selecting Sign contract, I intend to sign this exact document.';

export type ContractEventType = 'assigned' | 'viewed' | 'signed';
export type EventInput = { type: ContractEventType; memberId?: number; adminId?: number; ip?: string; userAgent?: string; data?: Record<string, unknown> };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}

export function hashEvent(input: { previousHash: string | null; assignmentId: number; type: ContractEventType; occurredAt: string; memberId: number | null; adminId: number | null; ip: string; userAgent: string; data: Record<string, unknown> }): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

/** Caller holds a FOR UPDATE lock on the assignment until transaction commit. */
export async function appendContractEvent(client: PoolClient, assignmentId: number, event: EventInput): Promise<string> {
  const previous = await client.query<{ event_hash: string }>('SELECT event_hash FROM participant_contract_events WHERE assignment_id=$1 ORDER BY id DESC LIMIT 1', [assignmentId]);
  const previousHash = previous.rows[0]?.event_hash ?? null;
  const occurredAt = new Date().toISOString();
  const memberId = event.memberId ?? null;
  const adminId = event.adminId ?? null;
  const ip = (event.ip ?? '').slice(0, 100);
  const userAgent = (event.userAgent ?? '').slice(0, 500);
  const data = event.data ?? {};
  const eventHash = hashEvent({ previousHash, assignmentId, type: event.type, occurredAt, memberId, adminId, ip, userAgent, data });
  await client.query(`INSERT INTO participant_contract_events
    (assignment_id,event_type,occurred_at,actor_member_id,actor_admin_id,ip,user_agent,event_data,previous_hash,event_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [assignmentId,event.type,occurredAt,memberId,adminId,ip,userAgent,JSON.stringify(data),previousHash,eventHash]);
  return eventHash;
}

export function verifyContractEvents(rows: Array<{ assignment_id: number; event_type: ContractEventType; occurred_at: Date | string; actor_member_id: number | null; actor_admin_id: number | null; ip: string | null; user_agent: string | null; event_data: Record<string, unknown>; previous_hash: string | null; event_hash: string }>): { valid: boolean; checked: number; firstInvalidIndex: number | null } {
  let previousHash: string | null = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const occurredAt = new Date(row.occurred_at).toISOString();
    const expected = hashEvent({ previousHash, assignmentId: Number(row.assignment_id), type: row.event_type, occurredAt, memberId: row.actor_member_id, adminId: row.actor_admin_id, ip: row.ip ?? '', userAgent: row.user_agent ?? '', data: row.event_data });
    if (row.previous_hash !== previousHash || row.event_hash !== expected) return { valid: false, checked: index, firstInvalidIndex: index };
    previousHash = row.event_hash;
  }
  return { valid: true, checked: rows.length, firstInvalidIndex: null };
}

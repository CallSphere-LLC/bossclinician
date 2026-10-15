import { describe, expect, it } from 'vitest';
import { hashEvent, verifyContractEvents } from './contractAudit';

const base = {
  previousHash: null,
  assignmentId: 42,
  type: 'signed' as const,
  occurredAt: '2026-10-15T12:00:00.000Z',
  memberId: 7,
  adminId: null,
  ip: '192.0.2.1',
  userAgent: 'test-browser',
  data: { typedName: 'Sample Signer', pdfSha256: 'a'.repeat(64), electronicConsent: true },
};

describe('contract audit hash chain', () => {
  it('preserves a stable hash after JSONB reorders event data', () => {
    const eventHash = hashEvent(base);
    const row = {
      assignment_id: 42,
      event_type: base.type,
      occurred_at: new Date(base.occurredAt),
      actor_member_id: 7,
      actor_admin_id: null,
      ip: base.ip,
      user_agent: base.userAgent,
      event_data: { electronicConsent: true, pdfSha256: 'a'.repeat(64), typedName: 'Sample Signer' },
      previous_hash: null,
      event_hash: eventHash,
    };
    expect(verifyContractEvents([row])).toEqual({ valid: true, checked: 1, firstInvalidIndex: null });
    expect(verifyContractEvents([{ ...row, event_data: { ...row.event_data, typedName: 'Someone Else' } }]).valid).toBe(false);
  });
});

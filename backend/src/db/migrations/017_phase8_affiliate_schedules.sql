-- =============================================================================
-- Phase 8 (follow-up) — affiliate schedules
--
-- Migration 011 laid down the platform's schedules before the affiliate tables
-- existed. Without these rows the commission ledger never accrues: a partner's
-- sales would be attributed correctly on the order and then simply never turn
-- into anything payable, with nothing failing and nobody told.
-- =============================================================================

INSERT INTO job_schedules (name, kind, every_minutes, daily_at_minute, timezone) VALUES
  -- Accrual reads succeeded transactions, so it trails the payment rather than
  -- racing it. Half-hourly is well inside the refund window that gates payout.
  ('affiliate-accrual',  'affiliates.accrue',   30,   NULL, 'America/New_York'),
  -- Clawbacks sweep `refunds` rather than reacting to an event, because a refund
  -- reaches the platform by several paths and only the table sees all of them.
  ('affiliate-clawback', 'affiliates.clawback', 60,   NULL, 'America/New_York'),
  -- The denormalised counters behind the partner list and their own dashboard.
  ('affiliate-rollup',   'affiliates.rollup',   NULL, 240,  'America/New_York')
ON CONFLICT (name) DO NOTHING;

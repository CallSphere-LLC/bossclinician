-- Accepted subscriptions, separate from legacy anonymous funnel counters.
-- Historical funnel_steps.conversions is deliberately preserved, not backfilled
-- as verified conversions. One subscriber may complete each opt-in step once.
CREATE TABLE IF NOT EXISTS funnel_subscription_conversions (
  step_id INT NOT NULL REFERENCES funnel_steps(id) ON DELETE CASCADE,
  subscriber_id INT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (step_id, subscriber_id)
);

-- New CTA clicks remain distinct from accepted subscriptions. Legacy values
-- in conversions are retained as historical, unauthenticated totals.
ALTER TABLE funnel_steps ADD COLUMN IF NOT EXISTS clicks INT NOT NULL DEFAULT 0;

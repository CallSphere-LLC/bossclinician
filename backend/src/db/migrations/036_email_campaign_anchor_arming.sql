-- Event-relative email scheduling, made safe to switch on.
--
-- 034 added `anchor_kind` / `anchor_event_id` / `anchor_offset_minutes` and the
-- sweeper that resolves them, but nothing recorded WHEN a campaign was pointed
-- at an event. Without that moment the sweeper cannot tell these two apart:
--
--   * "24 hours before the CEU", set up a week ago, and the moment has arrived
--     — send it;
--   * "24 hours before the CEU", set up just now, for a CEU that starts in
--     twelve hours — the send moment was twelve hours ago, and firing it is a
--     backlog blast under the owner's name that cannot be recalled.
--
-- `anchor_armed_at` is stamped by the route that arms the anchor, server-side,
-- so a client cannot choose it. The rule the sweeper applies is then a single
-- comparison: a send moment earlier than the arming moment is past-due and is
-- never sent.
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS anchor_armed_at timestamptz,
  -- Why an anchored campaign was passed over, in words the owner can read on
  -- the campaign list. A campaign that silently sat on "Scheduled" forever was
  -- the alternative, and "did that email go?" is the question this screen
  -- exists to answer.
  ADD COLUMN IF NOT EXISTS anchor_skip_reason text NOT NULL DEFAULT '';

-- Anything already anchored predates the stamp. Treat the row's last edit as
-- the arming moment: it is the most conservative reading available, and it is
-- the reading that skips a backlog rather than sending one.
UPDATE email_campaigns
   SET anchor_armed_at = updated_at
 WHERE anchor_kind <> 'absolute'
   AND anchor_armed_at IS NULL;

-- Deleting an event must not be blocked by a campaign pointed at it.
--
-- `anchor_event_id` is ON DELETE SET NULL, and SET NULL is an UPDATE, so the
-- CHECK that 034 added ("a non-absolute anchor must name an event") fired on
-- every attempt to delete an event that any campaign referenced — the delete
-- failed with a constraint violation and no explanation. The requirement is
-- real but it belongs where it can be explained: the arming route refuses an
-- anchor with no event, and the sweeper marks an anchor whose event has since
-- been deleted as skipped, with a reason, instead of retrying it forever.
ALTER TABLE email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_anchor_event_check;

-- The composer offers a 25/50 split; the constraint 024 shipped caps the B arm
-- at 50%, which is right — a "test" that sends 75% of the list the variant is
-- not a test — but the picker offered 75% and the save failed with a raw
-- Postgres message. The picker is fixed; this pins the intent next to it.
COMMENT ON COLUMN email_campaigns.ab_split_percent IS
  'Share of the audience that gets subject B, 0-50. 0 means no test.';

-- Anchored campaigns are swept by id every couple of minutes; the sweep reads
-- status and anchor_kind and nothing else.
CREATE INDEX IF NOT EXISTS email_campaigns_anchor_idx
  ON email_campaigns (anchor_kind, status)
  WHERE anchor_kind <> 'absolute';

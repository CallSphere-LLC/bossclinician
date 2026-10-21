-- Optimistic concurrency for private member dashboards. Existing entries remain intact.
ALTER TABLE member_tool_state ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

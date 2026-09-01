import { describe, it, expect } from "vitest";
import {
  MAILABLE_CONTACT_COUNT_SQL,
  MAILABLE_CONTACT_SERIES_SQL,
  MAILABLE_CONTACT_SQL,
} from "./audience";
import { audiencePredicate } from "./broadcasts";

/**
 * P0-2 regression: six screens, one answer.
 *
 * The bug these pin was not a wrong number, it was six numbers. Five of the six
 * screens counted rows in `subscribers` — a table only the public newsletter
 * box and one legacy automation action ever write — while Contacts and Segments
 * counted `contacts`. On a site whose five contacts had all arrived some other
 * way, that read as "0 subscribers" everywhere, and the send path used the same
 * membership test, so `startBroadcast` refused with "Nobody in that audience
 * can be emailed right now". Broadcasts could not go out at all.
 *
 * These are string assertions rather than query results because the predicate
 * is the shared artefact: the whole point is that every screen interpolates the
 * *same* SQL. A behavioural test would need a database and would still only
 * cover whichever screen it exercised.
 */
describe("the canonical email-list predicate", () => {
  it("tests consent, not membership of the legacy subscribers table", () => {
    // The regression in one line. If `subscribers` reappears here, the five
    // screens have silently diverged again.
    expect(MAILABLE_CONTACT_SQL).not.toContain("subscribers");
    expect(MAILABLE_CONTACT_SQL).toContain("email_marketing_status");
  });

  it("counts somebody who has consented and has not been suppressed", () => {
    // 'unconfirmed' is deliberately mailable: a double-opt-in that was never
    // completed is still a person who asked, and excluding them silently
    // shrank the list.
    expect(MAILABLE_CONTACT_SQL).toContain("'subscribed'");
    expect(MAILABLE_CONTACT_SQL).toContain("'unconfirmed'");
  });

  it("excludes anyone on the suppression list", () => {
    // Bounces and complaints are address-level and outlive the contact row, so
    // the status column alone is not enough.
    expect(MAILABLE_CONTACT_SQL).toContain("email_suppressions");
    expect(MAILABLE_CONTACT_SQL).toContain("NOT EXISTS");
  });

  it("excludes contacts with no address at all", () => {
    expect(MAILABLE_CONTACT_SQL).toContain("c.email <> ''");
  });

  it("is written against the alias every caller uses", () => {
    // Each caller interpolates this into a query of its own that aliases
    // contacts as `c`. A bare column name would resolve against whatever table
    // happened to be in scope.
    expect(MAILABLE_CONTACT_SQL).toContain("c.email_marketing_status");
  });

  it("carries its own FROM in the scalar-subquery form", () => {
    // The totals rows select several counts at once, so this one has to be
    // self-contained; without its own FROM it would correlate with the
    // enclosing query's `c` and count one row.
    expect(MAILABLE_CONTACT_COUNT_SQL).toContain("FROM contacts c");
    expect(MAILABLE_CONTACT_COUNT_SQL.startsWith("(")).toBe(true);
    expect(MAILABLE_CONTACT_COUNT_SQL.endsWith(")")).toBe(true);
  });

  it("dates the trend series by consent, falling back to the row's birthday", () => {
    // `opted_in_at` is only populated on newer write paths. Keying on it alone
    // would drop every older contact out of the 30-day chart.
    expect(MAILABLE_CONTACT_SERIES_SQL).toContain("COALESCE(c.opted_in_at, c.created_at)");
    expect(MAILABLE_CONTACT_SERIES_SQL).toContain("GROUP BY 1");
  });

  it("uses one definition, so the series and the total cannot drift apart", () => {
    for (const sql of [MAILABLE_CONTACT_COUNT_SQL, MAILABLE_CONTACT_SERIES_SQL]) {
      expect(sql).toContain(MAILABLE_CONTACT_SQL);
    }
  });
});

describe("the campaign audience keys", () => {
  it('resolves "everyone on my email list" without joining the empty silo', () => {
    // This join is what blocked the send. Every audience is already narrowed by
    // MAILABLE, so requiring a `subscribers` row could only ever remove people
    // who had consented — and here it removed all of them.
    const predicate = audiencePredicate("all_subscribers");
    expect(predicate).not.toBeNull();
    expect(predicate).not.toContain("subscribers");
  });

  it("reaches the same people whether the audience says contacts or subscribers", () => {
    // Both are "everyone we may email", because MAILABLE supplies the
    // consent test. Keeping the two keys apart is what let them disagree.
    expect(audiencePredicate("all_subscribers")).toBe(audiencePredicate("all_contacts"));
  });

  it("still refuses an unknown key rather than mailing everybody", () => {
    // The old estimator in growth.ts defaulted an unrecognised key to the whole
    // list. That fallback is gone from both the estimate and the send.
    expect(audiencePredicate("all_subscibers")).toBeNull();
    expect(audiencePredicate("")).toBeNull();
  });

  it("still narrows the other audiences rather than opening them up", () => {
    // Only the two "everyone" keys are unconditional; a regression that
    // flattened these would mail members to the whole list.
    for (const key of ["all_members", "leads", "community", "customers"]) {
      expect(audiencePredicate(key)).not.toBe("TRUE");
    }
  });
});

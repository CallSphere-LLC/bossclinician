import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { pool } from "../db/pool";
import { runAutomation, type RunContext } from "./engineV2";

/**
 * P0-6 regression: the status a run reports.
 *
 * The headline of the bug is one word in one column. An automation whose only
 * step had nothing chosen wrote `automation_runs.status = 'success'`, which the
 * history screen renders as RAN FINE — so the only place that could have told
 * the owner her automation did nothing told her it had worked.
 *
 * The database is faked rather than reached, because what is being pinned is
 * arithmetic the runner does over its own steps, and the four statements it
 * needs are `INSERT … automation_runs`, the action list, the log append and the
 * status write. A step that was never configured returns before it touches
 * anything else, which is exactly why it was so cheap to report as a success.
 */
vi.mock("../db/pool", () => ({ pool: { query: vi.fn() } }));

interface FakeAction {
  id: number;
  action_type: string;
  config: Record<string, unknown>;
  delay_minutes: number;
  conditions: Record<string, unknown>;
  sort: number;
}

function step(actionType: string, config: Record<string, unknown>, id = 1): FakeAction {
  return { id, action_type: actionType, config, delay_minutes: 0, conditions: {}, sort: id };
}

const CONTEXT: RunContext = {
  trigger: "offer_purchased",
  contactId: 7,
  email: "someone@example.com",
  name: "Someone",
  subjectId: null,
  facts: {},
};

/** Answers the four statements a dry run makes, and records what it was told. */
function databaseHolding(actions: FakeAction[]): { statuses: string[]; lines: string[] } {
  const statuses: string[] = [];
  const lines: string[] = [];

  (pool.query as unknown as Mock).mockImplementation(
    async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT INTO automation_runs")) return { rows: [{ id: 99 }], rowCount: 1 };
      if (sql.includes("FROM automation_actions")) return { rows: actions, rowCount: actions.length };
      if (sql.includes("UPDATE automation_runs SET log")) {
        lines.push(...(JSON.parse(String(params[1])) as string[]));
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE automation_runs SET status")) {
        statuses.push(String(params[1]));
        return { rows: [], rowCount: 1 };
      }
      // The tag the one good step points at.
      if (sql.includes("FROM tags")) return { rows: [{ slug: "visionary" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  );

  return { statuses, lines };
}

describe("how a run reports a step nobody finished", () => {
  beforeEach(() => {
    (pool.query as unknown as Mock).mockReset();
  });

  it("does not call a run successful when a step had nothing chosen", () => {
    const { statuses } = databaseHolding([step("add_tag", {})]);

    return runAutomation({ automationId: 2, context: CONTEXT, isTest: true }).then((result) => {
      // The repro, in one assertion.
      expect(result.status).not.toBe("success");
      expect(result.status).toBe("failed");
      // And the row behind the badge says the same thing as the answer.
      expect(statuses).toEqual(["failed"]);
    });
  });

  it("writes what was wrong into the log rather than a shrug", () => {
    const { lines } = databaseHolding([step("add_tag", {})]);

    return runAutomation({ automationId: 2, context: CONTEXT, isTest: true }).then(() => {
      // "Tag: none chosen" was true and useless; it read as a step that had
      // considered the matter and moved on.
      expect(lines.join(" ")).toContain("has no tag chosen");
    });
  });

  it("still finishes the run, so one bad step does not lose the others", () => {
    const { statuses, lines } = databaseHolding([
      step("add_tag", {}, 1),
      step("add_tag", { tagId: 3 }, 2),
    ]);

    return runAutomation({ automationId: 2, context: CONTEXT, isTest: true }).then((result) => {
      // Partial, not failed: the second step did happen, and a run that threw
      // on the first would have hidden that.
      expect(result.status).toBe("partial");
      expect(statuses).toEqual(["partial"]);
      expect(lines.join(" ")).toContain("would add");
    });
  });

  it("still calls a finished automation a success", () => {
    // The gate has to be about being unfinished, not about being strict: a
    // check that failed everything would be found by nobody until it had
    // paused the whole account's automations.
    const { statuses } = databaseHolding([step("add_tag", { tagId: 3 })]);

    return runAutomation({ automationId: 2, context: CONTEXT, isTest: true }).then((result) => {
      expect(result.status).toBe("success");
      expect(statuses).toEqual(["success"]);
    });
  });

  it("does not count a real wait a practice run cannot serve", () => {
    // A dry run reaches a configured wait in the same place as an empty one,
    // and calling that a failure would report every automation with a delay in
    // it as broken.
    const { statuses } = databaseHolding([step("wait", { days: 3 })]);

    return runAutomation({ automationId: 2, context: CONTEXT, isTest: true }).then((result) => {
      expect(result.status).toBe("success");
      expect(statuses).toEqual(["success"]);
    });
  });

  it("counts a wait that waits no time, which the runner never performs", () => {
    // A `wait` is handled by the loop rather than by `performAction`, so it
    // needs its own count or an automation whose only pause was never set
    // reports itself as having waited.
    const { statuses } = databaseHolding([step("wait", { days: 0, minutes: 0 })]);

    return runAutomation({ automationId: 2, context: CONTEXT, isTest: true }).then((result) => {
      expect(result.status).not.toBe("success");
      expect(statuses).toEqual([result.status]);
    });
  });
});

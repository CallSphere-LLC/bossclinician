import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIGGER_TYPES } from "../automations/engineV2";

const { query, enqueue, fireTrigger, dispatchEvent } = vi.hoisted(() => ({
  query: vi.fn(),
  enqueue: vi.fn(),
  fireTrigger: vi.fn(),
  dispatchEvent: vi.fn(),
}));

vi.mock("../db/pool", () => ({ pool: { query } }));
vi.mock("../jobs/queue", () => ({ enqueue, PRIORITY: { normal: 0 } }));
vi.mock("../automations/engineV2", async (original) => {
  const actual = await original<typeof import("../automations/engineV2")>();
  return { ...actual, fireTrigger };
});
vi.mock("./webhooksOut", () => ({ dispatchEvent }));

import {
  dispatchDomainEvent,
  domainEventJobKey,
  publishDomainEvent,
  webhookEventsFor,
} from "./domainEvents";

describe("durable domain-event bus", () => {
  beforeEach(() => {
    query.mockReset();
    enqueue.mockReset();
    fireTrigger.mockReset();
    dispatchEvent.mockReset();
    enqueue.mockResolvedValue("job-1");
    fireTrigger.mockResolvedValue(undefined);
    dispatchEvent.mockResolvedValue(1);
  });

  it.each(TRIGGER_TYPES)("persists and queues the %s trigger", async (trigger) => {
    query.mockResolvedValueOnce({ rows: [{ id: "42" }] });

    await publishDomainEvent(trigger, {
      eventKey: `${trigger}:fixture`,
      contactId: 7,
      email: "success+person@simulator.amazonses.com",
      subjectId: 9,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO domain_events"),
      expect.arrayContaining([`${trigger}:fixture`, trigger, 7, "success+person@simulator.amazonses.com"]),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "domainEvents.dispatch",
        payload: { eventId: "42" },
        dedupeKey: domainEventJobKey("42"),
      }),
    );
  });

  it.each(TRIGGER_TYPES)("dispatches %s into the automation runner", async (trigger) => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "42",
            event_key: `${trigger}:fixture`,
            event_type: trigger,
            contact_id: 7,
            email: "success+person@simulator.amazonses.com",
            name: "Person",
            subject_id: 9,
            source: "test",
            facts: { answer: "yes" },
            processed_at: null,
            created_at: new Date("2026-09-02T12:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await dispatchDomainEvent({ eventId: 42 });

    expect(fireTrigger).toHaveBeenCalledWith(
      trigger,
      expect.objectContaining({
        eventKey: `${trigger}:fixture`,
        contactId: 7,
        subjectId: 9,
      }),
      { rethrow: true },
    );
  });

  it("reuses a stored event when the same occurrence is published twice", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "88" }] });

    const result = await publishDomainEvent("tag_added", {
      eventKey: "tag-added:one-occurrence",
      contactId: 3,
    });

    expect(result).toEqual({ id: "88", created: false });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: domainEventJobKey("88") }),
    );
  });

  it("does not execute a processed event again", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: "42", processed_at: new Date(), event_type: "tag_added" }],
    });

    await expect(dispatchDomainEvent({ eventId: 42 })).resolves.toEqual({
      skipped: "event already processed",
    });
    expect(fireTrigger).not.toHaveBeenCalled();
  });

  it("maps shared business events to the public webhook catalogue", () => {
    expect(webhookEventsFor("contact_created")).toEqual(["contact.created"]);
    expect(webhookEventsFor("tag_added")).toEqual(["contact.tagged"]);
    expect(webhookEventsFor("offer_purchased")).toEqual(["order.paid"]);
    expect(webhookEventsFor("subscription_cancelled")).toEqual(["subscription.cancelled"]);
    expect(webhookEventsFor("form_submitted")).toEqual(["form.submitted"]);
    expect(webhookEventsFor("lesson_completed")).toEqual([]);
  });
});

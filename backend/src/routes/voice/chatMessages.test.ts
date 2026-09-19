import { describe, expect, it } from "vitest";
import { messageSchema, toModelInput } from "./chat";

describe("Responses tool call history", () => {
  it("preserves catalog lookup arguments beside its matching result", () => {
    const args = { resource: "tags", action: "update", id: "61", read: true };
    const message = messageSchema.parse({ role: "tool", toolCallId: "catalog-1", name: "admin_operation_catalog", arguments: args, content: '{"schema":{},"records":[{"id":61}]}' });
    expect(toModelInput([message])).toEqual([
      { type: "function_call", call_id: "catalog-1", name: "admin_operation_catalog", arguments: JSON.stringify(args) },
      { type: "function_call_output", call_id: "catalog-1", output: message.content },
    ]);
  });
  it("retains nested exact approved payloads and supports older clients", () => {
    const args = { actionId: "admin.request", params: { resource: "tags", action: "update", id: "61", body: { description: "Approved value", enabled: false, labels: ["one", null] } } };
    const message = { role: "tool", toolCallId: "proposal-1", name: "propose_admin_action", content: "Approved" };
    expect(toModelInput([messageSchema.parse({ ...message, arguments: args })])[0].arguments).toBe(JSON.stringify(args));
    expect(toModelInput([messageSchema.parse(message)])[0].arguments).toBe("{}");
  });
  it("rejects non-object, non-JSON and oversized arguments", () => {
    const message = { role: "tool", toolCallId: "catalog-1", name: "admin_operation_catalog", content: "result" };
    for (const args of ["{}", [], { value: undefined }, { text: "x".repeat(8001) }]) {
      expect(messageSchema.safeParse({ ...message, arguments: args }).success).toBe(false);
    }
  });
});

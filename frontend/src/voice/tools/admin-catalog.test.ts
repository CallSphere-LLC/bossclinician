import { describe, expect, it, vi } from "vitest";
import { buildAdminCatalogTool } from "./admin-catalog";
import type { VoiceContext } from "../contract";

describe("admin operation discovery", () => {
  it.each([true, false])("retains the requested update schema when reading a record (detail=%s)", async (detail) => {
    const schema = { type: "object", properties: { name: { type: "string" } }, additionalProperties: false };
    const catalog = { resource: "tags", action: "update", method: "PUT", readPath: "/admin/tags", identifier: "id", detail, schema };
    const record = { id: 12, name: "Before update" };
    const get = vi.fn().mockResolvedValueOnce(catalog).mockResolvedValueOnce(detail ? record : [record, { id: 13, name: "Other" }]);
    const context = { surface: "admin", call: { get } } as unknown as VoiceContext;
    const tool = buildAdminCatalogTool((definition) => definition, context);
    expect(await tool.execute({ resource: "tags", action: "update", read: true, id: "12" })).toEqual({ ...catalog, records: detail ? record : [record] });
    expect(get).toHaveBeenLastCalledWith(detail ? "/admin/tags/12" : "/admin/tags");
  });
});

import type { ConciergeTool, ToolFn, VoiceContext } from "../contract";

/** Read only discovery; all mutations still pass through the approval tools. */
export function buildAdminCatalogTool(toolFn: ToolFn, ctx: VoiceContext): ConciergeTool {
  return toolFn({
    name: "admin_operation_catalog",
    description: "Discover supported admin changes with their actual API schemas. Start without a resource for the list; then specify resource and action create/update/delete for its fields. Set read=true to list existing records, or include id to read one, before proposing an update or deletion. The response includes BOTH the requested action schema and records. Once the schema and target record are available, proceed to propose_admin_action with actionId admin.request and params containing resource, action, id and body; do not repeat the same catalog request. Never invent identifiers, fields or unsupported actions.",
    parameters: { type: "object", properties: {
      resource: { type: "string" }, action: { type: "string", enum: ["create", "update", "delete"] },
      read: { type: "boolean" }, id: { type: "string" },
    }, additionalProperties: false },
    execute: async (args: { resource?: string; action?: string; read?: boolean; id?: string }) => {
      if (ctx.surface !== "admin") return { error: "Administrator access is required." };
      const query = new URLSearchParams();
      if (args.resource) query.set("resource", args.resource);
      if (args.action) query.set("action", args.action);
      const catalog = await ctx.call.get<{ readPath?: string; identifier?: string; detail?: boolean; [key: string]: unknown }>(`/voice/admin-catalog?${query}`);
      if (args.read && catalog.readPath) {
        if (!/^\/admin\/[a-z-]+$/.test(catalog.readPath)) throw new Error("Invalid catalog path.");
        if (args.id && !(catalog.identifier === "slug" ? /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/ : /^[1-9][0-9]*$/).test(args.id)) throw new Error("Invalid record identifier.");
        const records = await ctx.call.get<unknown>(catalog.readPath + (args.id && catalog.detail !== false ? `/${encodeURIComponent(args.id)}` : ""));
        if (args.id && catalog.detail === false) {
          const rows = Array.isArray(records) ? records : (records as { items?: unknown[] }).items ?? [];
          return { ...catalog, resource: args.resource, records: rows.filter((row) => String((row as { id: unknown }).id) === args.id) };
        }
        return { ...catalog, resource: args.resource, records };
      }
      return catalog;
    },
  }) as ConciergeTool;
}

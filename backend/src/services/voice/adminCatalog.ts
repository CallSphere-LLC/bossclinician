import { z } from "zod";
import { blogSchema, blogUpdateSchema, courseSchema, courseUpdateSchema, testimonialSchema, testimonialUpdateSchema, resourceSchema, resourceUpdateSchema, pageUpdateSchema } from "../../validation/schemas";
import { createSchema as tagsCreate, updateSchema as tagsUpdate } from "../../routes/admin/tags";
import { createSchema as segmentsCreate, updateSchema as segmentsUpdate } from "../../routes/admin/segments";
import { createSchema as contactsCreate, updateSchema as contactsUpdate } from "../../routes/admin/contacts";
import { createSchema as membersCreate, updateSchema as membersUpdate } from "../../routes/admin/members";
import { formSchema } from "../../routes/admin/formsV2";
import { eventSchema } from "../../routes/admin/events";
import { sequenceSchema } from "../../routes/admin/sequences";
import { assessmentSchema } from "../../routes/admin/assessments";
import { automationSchema } from "../../routes/admin/automationsV2";

type Resource = { key: string; path: string; create?: z.ZodType; update: z.ZodType; method?: "PUT" | "PATCH"; identifier?: "slug"; delete?: boolean; detail?: boolean };
/** These are the actual handlers' validators, never a model-invented API contract. */
export const ADMIN_RESOURCES: Resource[] = [
  { key: "blog", path: "/admin/blog", create: blogSchema, update: blogUpdateSchema },
  { key: "courses", path: "/admin/courses", create: courseSchema, update: courseUpdateSchema },
  { key: "testimonials", path: "/admin/testimonials", create: testimonialSchema, update: testimonialUpdateSchema },
  { key: "resources", path: "/admin/resources", create: resourceSchema, update: resourceUpdateSchema },
  { key: "pages", path: "/admin/pages", update: pageUpdateSchema, identifier: "slug", delete: false },
  { key: "tags", detail: false, path: "/admin/tags", create: tagsCreate, update: tagsUpdate },
  { key: "segments", path: "/admin/segments", create: segmentsCreate, update: segmentsUpdate },
  { key: "contacts", path: "/admin/contacts", create: contactsCreate, update: contactsUpdate },
  { key: "members", detail: false, path: "/admin/members", create: membersCreate, update: membersUpdate },
  { key: "forms", path: "/admin/forms-v2", create: formSchema, update: formSchema.partial(), method: "PATCH" },
  { key: "events", path: "/admin/events", create: eventSchema, update: eventSchema.partial(), method: "PATCH" },
  { key: "sequences", path: "/admin/sequences", create: sequenceSchema, update: sequenceSchema.partial(), method: "PATCH" },
  { key: "assessments", path: "/admin/assessments", create: assessmentSchema, update: assessmentSchema.partial(), method: "PATCH" },
  { key: "automations", path: "/admin/automations", create: automationSchema, update: automationSchema.partial(), method: "PATCH" },
];

export function adminCatalog(resource?: string, action?: string) {
  if (!resource) return { resources: ADMIN_RESOURCES.map(({ key }) => key), instructions: "Choose a resource and action create/update/delete to get its exact request schema. Read existing records before proposing an update or deletion. Uploads, credentials, billing/refunds and actions absent from this catalog must be completed in their own screen." };
  const entry = ADMIN_RESOURCES.find(({ key }) => key === resource);
  if (!entry) throw new Error("Unknown admin resource.");
  const schema = action === "create" ? entry.create : action === "delete" ? undefined : entry.update;
  return {
    resource: entry.key,
    ...(action ? { action } : {}),
    readPath: entry.path,
    detail: entry.detail !== false,
    identifier: entry.identifier ?? "id",
    operations: [...(entry.create ? ["create"] : []), "update", ...(entry.delete === false ? [] : ["delete"])],
    ...(schema ? { schema: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) } : {}),
  };
}

export function prepareAdminOperation(input: { resource: string; action: "create" | "update" | "delete"; id?: string; body?: Record<string, unknown> }) {
  const entry = ADMIN_RESOURCES.find(({ key }) => key === input.resource);
  if (!entry) throw new Error("Unknown admin resource.");
  if (input.action === "delete" && entry.delete === false) throw new Error("Deletion is unavailable for this resource.");
  let path = entry.path;
  if (input.action !== "create") {
    const id = input.id ?? "";
    if (!(entry.identifier === "slug" ? /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/ : /^[1-9][0-9]*$/).test(id)) throw new Error("Read the existing record and provide its exact identifier.");
    path += `/${encodeURIComponent(id)}`;
  }
  const schema = input.action === "create" ? entry.create : entry.update;
  if (input.action === "create" && !schema) throw new Error("Creation is unavailable for this resource.");
  const body = input.action === "delete" ? undefined : schema!.parse(input.body ?? {});
  return { resource: entry.key, action: input.action, path, method: input.action === "create" ? "POST" : input.action === "delete" ? "DELETE" : entry.method ?? "PUT", body };
}

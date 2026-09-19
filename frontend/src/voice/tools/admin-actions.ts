/**
 * admin-actions.ts — the two-step the owner's assistant has to dance before it
 * changes anything.
 *
 * Step one, `propose_admin_action`, describes the change in her words and waits
 * for a real answer. Step two, `run_approved_action`, is the only thing that
 * ever calls the admin API, and it refuses unless it is holding an approval
 * that names that exact proposal. Splitting them is what makes "yes" mean this
 * change rather than the last one discussed: a proposal is single-use, it
 * expires, and it is thrown away the moment it runs.
 *
 * A `destructive` action never accepts a voice-only yes. A microphone in a room
 * hears the television, a passer-by and a misheard "sure"; taking a live page
 * down deserves a deliberate tap on the card.
 *
 * The catalog is DATA — `{actionId, title, describe, run}` — so a new action is
 * one entry, not a new tool. Every entry here maps to an endpoint that exists
 * in backend/src/routes/admin/, and none of them sends mail to a real person.
 */

import type {
  ApprovalOutcome,
  ApprovalRequest,
  ConciergeTool,
  ToolFn,
  VoiceApiClient,
  VoiceContext,
} from "../contract";

/* ------------------------------------------------------------------ */
/*  The catalog                                                        */
/* ------------------------------------------------------------------ */

export type AdminActionParams = Record<string, unknown>;

export type AdminAction = {
  actionId: string;
  title: string;
  prepare?: (params: AdminActionParams, call: VoiceApiClient) => Promise<AdminActionParams>;
  risk: ApprovalRequest["risk"];
  /** What the model is allowed to fill in, as JSON Schema properties. */
  properties: Record<string, unknown>;
  /** The card and the spoken summary, in her words rather than the API's. */
  describe: (params: AdminActionParams) => { summary: string; details: { label: string; value: string }[] };
  /** Runs only after an approval that names this proposal. */
  run: (params: AdminActionParams, call: VoiceApiClient) => Promise<string>;
};

/**
 * A missing detail, not a broken action: the agent has to ask her something
 * before anything can run. Distinguished from a real refusal so the approval
 * trail files a reason only when there is one worth reading.
 */
class NeedsDetail extends Error {}

type BlogPost = { id: number; title: string; slug: string; published: boolean };
type Lead = { id: number; name: string; email: string; status: string };
type Contact = { id: number; name: string; email: string };

function text(params: AdminActionParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value.trim() : "";
}

function number(params: AdminActionParams, key: string): number | null {
  const value = params[key];
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** Find the post the owner means, by id when the agent has one and by title
 * otherwise — she says "the burnout article", never a row number. */
async function findPost(call: VoiceApiClient, params: AdminActionParams): Promise<BlogPost> {
  const posts = await call.get<BlogPost[]>("/admin/blog");
  const id = number(params, "postId");
  if (id !== null) {
    const byId = posts.find((post) => post.id === id);
    if (byId) return byId;
  }
  const title = text(params, "title").toLowerCase();
  if (!title) throw new NeedsDetail("Which post? Ask her for its title.");
  const match =
    posts.find((post) => post.title.toLowerCase() === title) ??
    posts.find((post) => post.title.toLowerCase().includes(title)) ??
    posts.find((post) => post.slug.toLowerCase().includes(title));
  if (!match) throw new NeedsDetail(`There is no post called "${text(params, "title")}". Ask her which one she means.`);
  return match;
}

async function findLead(call: VoiceApiClient, params: AdminActionParams): Promise<Lead> {
  const leads = await call.get<Lead[]>("/admin/leads");
  const id = number(params, "leadId");
  if (id !== null) {
    const byId = leads.find((lead) => lead.id === id);
    if (byId) return byId;
  }
  const person = text(params, "person").toLowerCase();
  if (!person) throw new NeedsDetail("Which enquiry? Ask her whose it is.");
  const match =
    leads.find((lead) => (lead.email ?? "").toLowerCase() === person) ??
    leads.find((lead) => (lead.name ?? "").toLowerCase().includes(person));
  if (!match) throw new NeedsDetail(`No enquiry from "${text(params, "person")}" is on the list. Ask her to say the name again.`);
  return match;
}

async function findContact(call: VoiceApiClient, params: AdminActionParams): Promise<Contact> {
  const id = number(params, "contactId");
  if (id !== null) return { id, name: text(params, "person") || `contact ${id}`, email: "" };
  const person = text(params, "person");
  if (!person) throw new NeedsDetail("Which person? Ask her for a name or an email address.");
  const found = await call.get<{ items: Contact[] }>(
    `/admin/contacts?q=${encodeURIComponent(person)}&limit=5`,
  );
  const first = found.items[0];
  if (!first) throw new NeedsDetail(`Nobody called "${person}" is in her contacts. Ask her to spell it.`);
  if (found.items.length > 1) {
    const names = found.items.map((item) => `${item.name || item.email}`).join(", ");
    throw new NeedsDetail(`More than one person matches "${person}": ${names}. Ask which one she means.`);
  }
  return first;
}

/** The enquiry states her screen offers, in her order. */
const LEAD_STATUSES = ["new", "contacted", "qualified", "closed", "archived"] as const;

export const ADMIN_ACTIONS: readonly AdminAction[] = [
  {
    actionId: "blog.publish",
    title: "Publish a blog post",
    risk: "normal",
    properties: {
      title: { type: "string", description: "The post's title, or enough of it to recognise." },
      postId: { type: "integer", description: "The post's id, when you already know it." },
    },
    describe: (params) => ({
      summary: `Put "${text(params, "title") || `post ${number(params, "postId") ?? ""}`}" live on the website, where anyone can read it.`,
      details: [
        { label: "Post", value: text(params, "title") || `#${number(params, "postId") ?? "?"}` },
        { label: "Change", value: "Draft → live on the site" },
      ],
    }),
    run: async (params, call) => {
      const post = await findPost(call, params);
      if (post.published) return `"${post.title}" was already live on the site — nothing needed doing.`;
      await call.put(`/admin/blog/${post.id}`, {
        published: true,
        publishedAt: new Date().toISOString(),
      });
      return `"${post.title}" is live on the site now, at /blog/${post.slug}.`;
    },
  },
  {
    actionId: "blog.unpublish",
    title: "Take a blog post off the website",
    // Destructive: the page is live, it may be linked from an email that went
    // out this morning, and taking it down is visible to everyone at once.
    risk: "destructive",
    properties: {
      title: { type: "string", description: "The post's title, or enough of it to recognise." },
      postId: { type: "integer", description: "The post's id, when you already know it." },
    },
    describe: (params) => ({
      summary: `Take "${text(params, "title") || `post ${number(params, "postId") ?? ""}`}" off the website. Anyone following a link to it will find nothing there.`,
      details: [
        { label: "Post", value: text(params, "title") || `#${number(params, "postId") ?? "?"}` },
        { label: "Change", value: "Live on the site → back to a draft" },
      ],
    }),
    run: async (params, call) => {
      const post = await findPost(call, params);
      if (!post.published) return `"${post.title}" was already a draft — nothing needed doing.`;
      await call.put(`/admin/blog/${post.id}`, { published: false });
      return `"${post.title}" is back to a draft and no longer on the website.`;
    },
  },
  {
    actionId: "lead.status",
    title: "Move an enquiry along",
    risk: "normal",
    properties: {
      person: { type: "string", description: "The name or email on the enquiry." },
      leadId: { type: "integer", description: "The enquiry's id, when you already know it." },
      status: {
        type: "string",
        enum: [...LEAD_STATUSES],
        description: "Where the enquiry should sit now.",
      },
    },
    describe: (params) => ({
      summary: `File ${text(params, "person") || "that enquiry"} under "${text(params, "status")}".`,
      details: [
        { label: "Enquiry", value: text(params, "person") || `#${number(params, "leadId") ?? "?"}` },
        { label: "New state", value: text(params, "status") },
      ],
    }),
    run: async (params, call) => {
      const status = text(params, "status");
      if (!LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])) {
        throw new NeedsDetail(`"${status}" is not one of the states an enquiry can be in. They are: ${LEAD_STATUSES.join(", ")}.`);
      }
      const lead = await findLead(call, params);
      await call.put(`/admin/leads/${lead.id}`, { status });
      return `${lead.name || lead.email}'s enquiry is filed under "${status}" now.`;
    },
  },
  {
    actionId: "contact.note",
    title: "Add a note to someone's record",
    risk: "normal",
    properties: {
      person: { type: "string", description: "The name or email of the person." },
      contactId: { type: "integer", description: "Their contact id, when you already know it." },
      note: { type: "string", description: "The note, in her words." },
    },
    describe: (params) => ({
      summary: `Add a note to ${text(params, "person") || "their record"}: "${text(params, "note")}"`,
      details: [
        { label: "Person", value: text(params, "person") || `#${number(params, "contactId") ?? "?"}` },
        { label: "Note", value: text(params, "note") },
      ],
    }),
    run: async (params, call) => {
      const note = text(params, "note");
      if (!note) throw new NeedsDetail("There is nothing to write down yet — ask her what the note should say.");
      const contact = await findContact(call, params);
      await call.post(`/admin/contacts/${contact.id}/notes`, { body: note });
      return `The note is on ${contact.name || contact.email}'s record, on their timeline.`;
    },
  },
  {
    actionId: "admin.request",
    title: "Apply an admin change",
    risk: "destructive",
    properties: {
      resource: { type: "string", description: "Resource from admin_operation_catalog." },
      action: { type: "string", description: "create, update or delete, as listed by the catalog." },
      id: { type: "string", description: "Existing record id or page slug, obtained by reading the record." },
      body: { type: "object", description: "Exact fields and values from that operation's schema." },
    },
    prepare: async (params, call) => {
      const prepared = await call.post<AdminActionParams>("/voice/admin-catalog/prepare", {
        resource: params.resource, action: params.action, id: params.id, body: params.body,
      });
      // The approval card must show every byte of the approved field values.
      for (const value of Object.values((prepared.body ?? {}) as Record<string, unknown>)) {
        if (JSON.stringify(value).length > 1800) throw new NeedsDetail("That field is too long to review in the approval card. Make this change in the editor so you can review it fully.");
      }
      return prepared;
    },
    describe: (params) => ({
      summary: `${text(params, "action")} ${text(params, "resource")}${text(params, "path").split("/").length > 3 ? ` record ${text(params, "path").split("/").pop()}` : ""}. Review the exact values below before approving.`,
      details: [
        { label: "Record", value: `${text(params, "resource")} ${text(params, "path").split("/").slice(3).join("/") || "(new)"}` },
        ...Object.entries((params.body ?? {}) as Record<string, unknown>).map(([label, value]) => ({ label, value: typeof value === "string" ? value : JSON.stringify(value) })),
      ],
    }),
    run: async (params, call) => {
      const path = text(params, "path");
      if (!/^\/admin\/[a-z-]+(?:\/[a-zA-Z0-9_-]+)?$/.test(path)) throw new Error("Invalid approved operation path.");
      const method = text(params, "method");
      if (method === "POST") await call.post(path, params.body);
      else if (method === "PUT") await call.put(path, params.body);
      else if (method === "PATCH" && call.patch) await call.patch(path, params.body);
      else if (method === "DELETE") await call.del(path);
      else throw new Error("Unsupported approved operation.");
      return `The ${text(params, "resource")} ${text(params, "action")} completed successfully.`;
    },
  },
];

const BY_ID = new Map(ADMIN_ACTIONS.map((action) => [action.actionId, action]));

/**
 * The catalog, written into the tool's own description.
 *
 * Without this the model would be told "fill in the details" and left to guess
 * whether the field is called `title` or `post` — and a guess turns a perfectly
 * clear request from the owner into "which post did you mean?". The field names
 * live in one place and are described from it.
 */
function describeCatalog(): string {
  return ADMIN_ACTIONS.map((action) => {
    const fields = Object.entries(action.properties)
      .map(([name, schema]) => {
        const described = schema as { description?: string };
        return described.description ? `${name} (${described.description})` : name;
      })
      .join(", ");
    const warning = action.risk === "destructive" ? " Needs a tap on the card, not just a spoken yes." : "";
    return `- ${action.actionId} — ${action.title}. Details: ${fields}.${warning}`;
  }).join("\n");
}

/**
 * Models sometimes send a nested object as a JSON string rather than an object.
 * Reading both spellings here costs three lines and saves the owner from being
 * asked to repeat herself because of a quoting habit.
 */
function readParams(raw: unknown): AdminActionParams {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as AdminActionParams;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as AdminActionParams;
      }
    } catch {
      // Not JSON after all; the action's own field checks will ask for what is
      // missing, which is a better answer than a parser error.
    }
  }
  return {};
}

/* ------------------------------------------------------------------ */
/*  The approval trail                                                 */
/* ------------------------------------------------------------------ */

/**
 * One row of the owner's approval trail, as `voice_approvals` holds it.
 *
 * An approval that exists only in a browser tab is not an auditable approval:
 * the promise made to Yvette is that nothing happens to her business without
 * her say-so, and a promise with no record is a claim. A REFUSAL is recorded
 * just as carefully as a consent — "she said no" is exactly the kind of fact an
 * audit trail exists to hold — and a timeout is a third, distinct answer.
 */
type ApprovalAudit = {
  actionId: string;
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  risk: ApprovalRequest["risk"];
  approved: boolean;
  answeredVia: ApprovalOutcome["via"];
  note?: string;
};

/**
 * Which conversation this is, for the row the server writes.
 *
 * The session comes in on the context rather than being discovered, and a call
 * that has not opened one yet writes nothing: there is no honest way for a tool
 * to work out which conversation it belongs to, and an invented id would file
 * one person's approvals against another person's call. An empty trail is a
 * gap; a wrong one looks like evidence.
 */
function sessionIdOf(ctx: VoiceContext): string | null {
  // Asked at the moment the tool runs, not when the context was built: the
  // context exists before the server has opened a row, so a value captured
  // there would be null for the whole call and every entry would go unwritten.
  const sessionId = ctx.getSessionId();
  return sessionId && sessionId.length > 0 ? sessionId : null;
}

/**
 * Record what she was asked and what she answered, and keep the id of that row.
 *
 * Never throws, and never stands between the owner and something she has just
 * authorised: if the write fails we say so in the console and carry on.
 * Refusing to do what she asked because a log entry did not land is the wrong
 * trade for this app.
 */
async function recordAnswer(ctx: VoiceContext, record: ApprovalAudit): Promise<string | null> {
  const sessionId = sessionIdOf(ctx);
  if (!sessionId) return null;
  try {
    const written = await ctx.call.post<{ approvalId: string }>("/voice/approval", {
      sessionId,
      ...record,
    });
    return written?.approvalId ?? null;
  } catch (error) {
    console.warn("Voice concierge: the approval trail was not written:", error);
    return null;
  }
}

/**
 * Close the row once the action has actually run.
 *
 * Approval and execution are two moments, and only this call may say the second
 * one happened. An action that failed in between is left exactly as it is —
 * "you said yes, and it did not run" — unless the failure came with words worth
 * reading, in which case they are filed with it.
 */
async function recordExecution(
  ctx: VoiceContext,
  approvalId: string | null,
  executed: boolean,
  note?: string,
): Promise<void> {
  const sessionId = sessionIdOf(ctx);
  if (!sessionId || !approvalId) return;
  try {
    await ctx.call.post("/voice/approval/executed", { sessionId, approvalId, executed, note });
  } catch (error) {
    console.warn("Voice concierge: the approval trail was not closed:", error);
  }
}

/* ------------------------------------------------------------------ */
/*  Proposals                                                          */
/* ------------------------------------------------------------------ */

/** A "yes" goes stale. Five minutes into a conversation it no longer refers to
 * anything either party still has in mind. */
const PROPOSAL_TTL_MS = 5 * 60_000;

export type Proposal = {
  id: string;
  action: AdminAction;
  params: AdminActionParams;
  /** Kept so the execution row says exactly what she approved, word for word. */
  request: ApprovalRequest;
  /** The row in her approval trail that this proposal is waiting to close. */
  approvalId: string | null;
  approved: boolean;
  via: "voice" | "chat" | "click" | "timeout" | "cancelled";
  note?: string;
  expiresAt: number;
};

/** Per-call state, created by the registry so two sessions never share one. */
export type ProposalStore = { proposals: Map<string, Proposal>; counter: number };

export function createProposalStore(): ProposalStore {
  return { proposals: new Map(), counter: 0 };
}

/**
 * May this approval actually be run?
 *
 * Pure, because it is the rule the whole surface rests on: approved, not
 * expired, and — when the change is destructive — answered by something more
 * deliberate than a spoken word.
 */
export function isRunnable(
  proposal: Pick<Proposal, "approved" | "via" | "expiresAt"> & { risk: ApprovalRequest["risk"] },
  now: number,
): { ok: true } | { ok: false; reason: string } {
  if (proposal.expiresAt <= now) {
    return { ok: false, reason: "That approval has gone stale. Offer it again from the top if she still wants it." };
  }
  if (!proposal.approved) {
    return { ok: false, reason: "She did not approve that, so it has not been done. Ask what she would like instead." };
  }
  if (proposal.risk === "destructive" && proposal.via !== "click") {
    return {
      ok: false,
      reason: "This one changes something the public can see, so a spoken yes is not enough. Ask her to tap Approve on the card, then try again.",
    };
  }
  return { ok: true };
}

export function buildProposeAdminActionTool(
  toolFn: ToolFn,
  ctx: VoiceContext,
  store: ProposalStore,
): ConciergeTool {
  return toolFn({
    name: "propose_admin_action",
    description: `Ask the owner to approve a change to her business before anything happens. She sees a card and can answer by voice, in the chat, or by tapping it. Nothing changes until she approves and you then call run_approved_action with the proposal you get back.\n\nWhat you can propose, and the details each one takes:\n${describeCatalog()}`,
    strict: false,
    parameters: {
      type: "object",
      properties: {
        actionId: {
          type: "string",
          enum: ADMIN_ACTIONS.map((action) => action.actionId),
          description: "Which change she is asking for.",
        },
        params: {
          type: "object",
          description:
            "The details for that change, using the field names listed for that action in this tool's description.",
          additionalProperties: true,
        },
      },
      required: ["actionId"],
      additionalProperties: false,
    },
    execute: async (args: { actionId?: string; params?: AdminActionParams | string }) => {
      const action = BY_ID.get(String(args?.actionId ?? "").trim());
      if (!action) {
        return `That is not something you can do. You can: ${ADMIN_ACTIONS.map((entry) => `${entry.actionId} (${entry.title})`).join(", ")}.`;
      }
      if (!ctx.requestApproval) {
        return "There is nobody signed in who could approve a change here, so nothing can be done. Explain what you would have done instead.";
      }

      let params = readParams(args?.params);
      if (action.prepare) {
        try { params = await action.prepare(params, ctx.call); }
        catch (error) { return `The change is not ready to approve: ${error instanceof Error ? error.message : String(error)}`; }
      }
      const described = action.describe(params);
      const request: ApprovalRequest = {
        actionId: action.actionId,
        title: action.title,
        summary: described.summary,
        details: described.details,
        risk: action.risk,
      };

      const outcome = await ctx.requestApproval(request);

      // Recorded the moment she answers, before anything runs: consent and
      // execution are two separate events, and a row that claimed an action ran
      // when the API call then failed would be worse than no row at all.
      const approvalId = await recordAnswer(ctx, {
        actionId: action.actionId,
        title: request.title,
        summary: request.summary,
        details: request.details,
        risk: request.risk,
        approved: outcome.approved,
        answeredVia: outcome.via,
        note: outcome.note,
      });

      store.counter += 1;
      const id = `${action.actionId}#${store.counter}`;
      store.proposals.set(id, {
        id,
        action,
        params,
        request,
        approvalId,
        approved: outcome.approved,
        via: outcome.via,
        note: outcome.note,
        expiresAt: Date.now() + PROPOSAL_TTL_MS,
      });

      if (!outcome.approved) {
        const how = outcome.via === "timeout" ? "did not answer" : "said no";
        return `She ${how}. Nothing has been changed. Acknowledge it in one short line and ask what she would like instead.${outcome.note ? ` She added: "${outcome.note}"` : ""}`;
      }

      const gate = isRunnable({ ...request, approved: true, via: outcome.via, expiresAt: Date.now() + PROPOSAL_TTL_MS }, Date.now());
      if (!gate.ok) return gate.reason;

      const amendment = outcome.note
        ? ` She added: "${outcome.note}" — if that changes what she wants, propose the amended version instead of running this one.`
        : "";
      return `Approved (${outcome.via}). Run it now with run_approved_action and proposal "${id}".${amendment}`;
    },
  }) as ConciergeTool;
}

export function buildRunApprovedActionTool(
  toolFn: ToolFn,
  ctx: VoiceContext,
  store: ProposalStore,
): ConciergeTool {
  return toolFn({
    name: "run_approved_action",
    description:
      "Carry out a change the owner has already approved, using the proposal you were given. Only ever call this after propose_admin_action came back approved. Then tell her in one short sentence what is now different.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        proposalId: { type: "string", description: "The proposal returned by propose_admin_action." },
      },
      required: ["proposalId"],
      additionalProperties: false,
    },
    execute: async (args: { proposalId?: string }) => {
      const id = String(args?.proposalId ?? "").trim();
      const proposal = store.proposals.get(id);
      if (!proposal) {
        return "That approval is not one this conversation is holding. Propose the change again and let her answer.";
      }

      const gate = isRunnable({ ...proposal, risk: proposal.action.risk }, Date.now());
      if (!gate.ok) {
        if (!proposal.approved || proposal.expiresAt <= Date.now()) store.proposals.delete(id);
        return gate.reason;
      }

      // Consumed before it runs: a retry after a slow network must not make the
      // change twice, and one "yes" is one change.
      store.proposals.delete(id);

      try {
        const result = await proposal.action.run(proposal.params, ctx.call);
        await recordExecution(ctx, proposal.approvalId, true);
        return `Done. ${result}`;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong and nothing was changed.";
        // A question back to the owner ("which post did you mean?") is not a
        // failure worth filing a reason for — the row already says she agreed
        // and nothing ran. A refusal from the API is, and its words are hers
        // to read, so those are the only ones that get written down.
        if (!(error instanceof NeedsDetail)) {
          await recordExecution(ctx, proposal.approvalId, false, message);
        }
        return `It did not go through. ${message}`;
      }
    },
  }) as ConciergeTool;
}

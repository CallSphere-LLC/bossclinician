import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { env, stripeTestMode } from "../config/env";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { appendContractEvent } from "./contractAudit";

/**
 * Contracts that come with an offer (QA row 164).
 *
 * An offer can name one or more participant contracts (migration 149,
 * `offer_contracts`). When somebody buys it, `fulfillPayment` calls
 * `assignOfferContractsSafely` inside its transaction and every linked contract
 * is assigned to the person who receives access — the gift recipient on a gift,
 * because they are the participant who has to sign.
 *
 * A purchase assignment is the same record a manual one from Coaching >
 * Contracts makes: one `participant_contract_assignments` row, an `assigned`
 * event at the head of its audit chain, and the same in-app notice and email.
 * `assignContract` is the one function both paths call, so they cannot drift.
 *
 * Idempotent without bookkeeping of its own: `fulfillPayment` returns early on
 * an order that is already paid, and UNIQUE(contract_id, member_id) means a
 * repeat purchase leaves the existing (possibly signed) assignment alone.
 */

type Queryable = Pick<PoolClient, "query">;

export const CONTRACT_ASSIGNED_KIND = "contract_assigned";
/** The member page that lists, shows and signs contracts. */
export const MEMBER_CONTRACTS_PATH = "/contracts";

export interface AssignedContract {
  assignmentId: number;
  contractId: number;
  title: string;
}

/** The in-app notice, by itself so the wording is tested once. */
export function contractNotice(title: string): { title: string; body: string; link: string } {
  return {
    title: `Please review and sign: ${title}`.slice(0, 200),
    body: "A contract has been added to your account. Open it to read the PDF and sign online.",
    link: MEMBER_CONTRACTS_PATH,
  };
}

const HONORIFIC = /^(dr|mr|mrs|ms|mx|miss|prof|professor)\.?$/i;

function greeting(firstName: string): string {
  const parts = firstName.trim().split(/\s+/).filter((part) => !HONORIFIC.test(part));
  return parts[0] || "there";
}

/** The email, by itself so it can be tested without a transport. */
export function contractAssignedEmail(input: {
  firstName: string;
  titles: string[];
  siteUrl?: string;
}): { subject: string; text: string; html: string } {
  const name = greeting(input.firstName);
  const url = `${input.siteUrl ?? env.publicSiteUrl}${MEMBER_CONTRACTS_PATH}`;
  const one = input.titles.length === 1;
  const subject = one ? `Please sign: ${input.titles[0]}` : "You have contracts to sign";
  const intro = one
    ? "There's a contract waiting for you in your Boss Clinician account:"
    : "There are contracts waiting for you in your Boss Clinician account:";
  const text = [
    `Hi ${name},`,
    ``,
    intro,
    ``,
    ...input.titles.map((title) => `- ${title}`),
    ``,
    `Sign in with this email address, read it through, and sign online here:`,
    ``,
    url,
    ``,
    `If you have any questions before you sign, just reply to this email.`,
    ``,
    `— Yvette`,
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<ul>${input.titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`,
    `<p>Sign in with this email address, read it through, and sign online:</p>`,
    `<p><a href="${escapeHtml(url)}">Review and sign</a></p>`,
    `<p>If you have any questions before you sign, just reply to this email.</p>`,
    `<p>— Yvette</p>`,
  ].join("\n");
  return { subject, text, html };
}

/**
 * Runs `work` under a savepoint so a failure rolls back only its own writes.
 * Inside fulfillment a failed statement would otherwise poison the payment's
 * transaction — and a charged customer must never lose access over a contract.
 */
async function withSavepoint<T>(client: Queryable, name: string, work: () => Promise<T>): Promise<T> {
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
    throw error;
  }
}

/** Writes the in-app notice; a failure is logged and never undoes the assignment. */
async function notifyContractAssigned(client: Queryable, memberId: number, title: string): Promise<void> {
  try {
    await withSavepoint(client, "contract_notice", async () => {
      const notice = contractNotice(title);
      await client.query(
        `INSERT INTO member_notifications (member_id, kind, title, body, link) VALUES ($1, $2, $3, $4, $5)`,
        [memberId, CONTRACT_ASSIGNED_KIND, notice.title, notice.body, notice.link]
      );
    });
  } catch (error) {
    console.error("[contracts] could not record the assignment notice", {
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Assigns one contract to one member, inside the caller's transaction.
 *
 * Returns null when the member already has this contract (or it no longer
 * exists) — the existing assignment, signed or not, is left exactly as it is.
 */
export async function assignContract(
  client: Queryable,
  input: {
    contractId: number;
    memberId: number;
    adminId?: number;
    ip?: string;
    userAgent?: string;
    /** Set when a purchase made the assignment. */
    orderId?: number | null;
    offerId?: number | null;
  }
): Promise<AssignedContract | null> {
  const inserted = await client.query<{ id: string | number; title: string }>(
    `INSERT INTO participant_contract_assignments (contract_id, member_id, source_order_id, source_offer_id)
     SELECT c.id, $2::int, $3::int, $4::int FROM participant_contracts c WHERE c.id = $1::bigint
     ON CONFLICT (contract_id, member_id) DO NOTHING
     RETURNING id`,
    [input.contractId, input.memberId, input.orderId ?? null, input.offerId ?? null]
  );
  const row = inserted.rows[0];
  if (!row) return null;
  const assignmentId = Number(row.id);

  const fromPurchase = input.orderId != null;
  await appendContractEvent(client as PoolClient, assignmentId, {
    type: "assigned",
    adminId: input.adminId,
    ip: input.ip,
    userAgent: input.userAgent,
    data: fromPurchase
      ? { contractId: input.contractId, memberId: input.memberId, orderId: input.orderId, offerId: input.offerId ?? null, source: "purchase" }
      : { contractId: input.contractId, memberId: input.memberId },
  });

  const titled = await client.query<{ title: string }>(`SELECT title FROM participant_contracts WHERE id = $1`, [input.contractId]);
  const title = titled.rows[0]?.title ?? "Your contract";
  await notifyContractAssigned(client, input.memberId, title);
  return { assignmentId, contractId: input.contractId, title };
}

/**
 * Assigns every contract linked to the offers in a paid order. Called by
 * fulfillPayment inside its transaction. Never throws: on any failure the
 * contract writes roll back to the savepoint, the error is logged, and the
 * payment and access grants commit as normal.
 */
export async function assignOfferContractsSafely(input: {
  client: Queryable;
  memberId: number;
  offerIds: number[];
  orderId: number;
}): Promise<AssignedContract[]> {
  const offerIds = [...new Set(input.offerIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (offerIds.length === 0) return [];
  try {
    return await withSavepoint(input.client, "offer_contracts", async () => {
      // One row per contract even when two offers in the cart share it.
      const linked = await input.client.query<{ contract_id: string | number; offer_id: number }>(
        `SELECT DISTINCT ON (contract_id) contract_id, offer_id
           FROM offer_contracts
          WHERE offer_id = ANY($1::int[])
          ORDER BY contract_id, offer_id`,
        [offerIds]
      );
      const assigned: AssignedContract[] = [];
      for (const row of linked.rows) {
        const result = await assignContract(input.client, {
          contractId: Number(row.contract_id),
          memberId: input.memberId,
          orderId: input.orderId,
          offerId: Number(row.offer_id),
        });
        if (result) assigned.push(result);
      }
      return assigned;
    });
  } catch (error) {
    console.error("[contracts] could not assign offer contracts", {
      orderId: input.orderId,
      memberId: input.memberId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Emails the member about newly assigned contracts. Call after COMMIT. Best
 * effort: the in-app notice and the Contracts page already carry the news, so a
 * failed send is logged, never thrown. Purchases made with Stripe test keys stay
 * silent, matching purchase delivery.
 */
export async function emailContractsAssigned(input: {
  memberId: number;
  contracts: AssignedContract[];
  fromPurchase?: boolean;
}): Promise<void> {
  if (input.contracts.length === 0) return;
  if (input.fromPurchase && stripeTestMode()) return;
  try {
    const found = await pool.query<{ email: string; first_name: string | null; name: string | null }>(
      `SELECT email::text AS email, first_name, name FROM members WHERE id = $1`,
      [input.memberId]
    );
    const member = found.rows[0];
    if (!member?.email) return;
    const content = contractAssignedEmail({
      firstName: member.first_name || (member.name ?? "").split(/\s+/)[0] || "",
      titles: input.contracts.map((contract) => contract.title),
    });
    await sendMail({
      topic: "contract_assigned",
      sourceId: input.contracts[0].assignmentId,
      memberId: input.memberId,
      to: member.email,
      ...content,
    });
  } catch (error) {
    console.error("[contracts] could not email the assignment", {
      memberId: input.memberId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ── Admin: which contracts an offer carries ─────────────────────────────── */

export async function contractsForOffer(offerId: number, db: Queryable = pool): Promise<Array<{ id: number; title: string }>> {
  const res = await db.query<{ id: string | number; title: string }>(
    `SELECT c.id, c.title FROM offer_contracts oc JOIN participant_contracts c ON c.id = oc.contract_id
      WHERE oc.offer_id = $1 AND NOT oc.required_before_payment ORDER BY c.title, c.id`,
    [offerId]
  );
  return res.rows.map((row) => ({ id: Number(row.id), title: row.title }));
}

/** Replaces the offer's linked contracts with exactly `contractIds`. */
export async function setOfferContracts(input: { offerId: number; contractIds: number[]; adminId?: number | null }): Promise<Array<{ id: number; title: string }>> {
  const ids = [...new Set(input.contractIds)];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Agreements required before payment (QA row 202) have their own settings.
    await client.query(`DELETE FROM offer_contracts WHERE offer_id = $1 AND NOT required_before_payment AND NOT (contract_id = ANY($2::bigint[]))`, [input.offerId, ids]);
    if (ids.length) {
      await client.query(
        `INSERT INTO offer_contracts (offer_id, contract_id, created_by)
         SELECT $1::int, c.id, $3::int FROM participant_contracts c WHERE c.id = ANY($2::bigint[])
         ON CONFLICT (offer_id, contract_id) DO NOTHING`,
        [input.offerId, ids, input.adminId ?? null]
      );
    }
    const linked = await contractsForOffer(input.offerId, client);
    await client.query("COMMIT");
    return linked;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

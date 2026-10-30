import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, notFound } from '../../utils/httpError';
import { isProtectedRef, protectedRef } from '../../services/signedUrls';
import { writeStoredMedia, removeStoredMedia } from '../../services/objectStorage';
import { verifyContractEvents } from '../../services/contractAudit';
import { readContractSource, serveContractPdf } from '../../services/contractStorage';
import { assignContract, contractsForOffer, emailContractsAssigned, setOfferContracts } from '../../services/offerContracts';
import { adminCheckoutRequirementsRouter } from './checkoutRequirements';

export const adminContractsRouter = Router();
adminContractsRouter.use(adminCheckoutRequirementsRouter);
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const idOf = (raw: string): number => { const id = Number(raw); if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid contract ID'); return id; };
const createSchema = z.object({ title: z.string().trim().min(3).max(200), mediaId: z.number().int().positive() });
const assignSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const offerContractsSchema = z.object({ contractIds: z.array(z.number().int().positive()).max(50) });

adminContractsRouter.get('/', asyncHandler(async (_req, res) => {
  // `offers`: the offers that assign this contract automatically on purchase (migration 149).
  const docs = await pool.query(`SELECT c.id,c.title,c.pdf_sha256,c.created_at,
    count(a.id)::int AS assigned_count, count(a.id) FILTER (WHERE a.status='signed')::int AS signed_count,
    COALESCE((SELECT json_agg(json_build_object('id',o.id,'title',o.title,'status',o.status) ORDER BY o.title)
      FROM offer_contracts oc JOIN offers o ON o.id=oc.offer_id WHERE oc.contract_id=c.id),'[]'::json) AS offers
    FROM participant_contracts c LEFT JOIN participant_contract_assignments a ON a.contract_id=c.id
    GROUP BY c.id ORDER BY c.id DESC`);
  const assignments = await pool.query(`SELECT a.id,a.contract_id,a.status,a.assigned_at,a.signed_at,
    a.signed_name,a.signed_email,a.evidence_sha256,m.email AS member_email,m.name AS member_name,
    a.source_order_id,so.title AS source_offer_title
    FROM participant_contract_assignments a JOIN members m ON m.id=a.member_id
    LEFT JOIN offers so ON so.id=a.source_offer_id ORDER BY a.id DESC`);
  res.json({ contracts: docs.rows.map(row => ({...row,id:Number(row.id)})), assignments: assignments.rows.map(row => ({...row,id:Number(row.id),contract_id:Number(row.contract_id)})) });
}));

adminContractsRouter.post('/', asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Choose a PDF and give the contract a title.', parsed.error.flatten());
  const media = await pool.query<{ url: string; mime: string }>('SELECT url,mime FROM media_assets WHERE id=$1', [parsed.data.mediaId]);
  const item = media.rows[0];
  if (!item || item.mime !== 'application/pdf' || !isProtectedRef(item.url)) throw badRequest('Upload a protected PDF before creating a contract.');
  const bytes = await readContractSource(item.url, MAX_PDF_BYTES);
  if (!bytes || bytes.subarray(0, 5).toString() !== '%PDF-') throw badRequest('The contract must be a valid PDF under 10 MB.');
  const pdfSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const reference = protectedRef(`contracts/${crypto.randomUUID()}.pdf`);
  await writeStoredMedia(reference, bytes, 'application/pdf');
  try {
    const created = await pool.query(`INSERT INTO participant_contracts(title,storage_ref,pdf_sha256,created_by)
      VALUES($1,$2,$3,$4) RETURNING id,title,pdf_sha256,created_at`,
      [parsed.data.title,reference,pdfSha256,Number(req.user?.sub) || null]);
    res.status(201).json({...created.rows[0],id:Number(created.rows[0].id)});
  } catch (error) {
    await removeStoredMedia(reference).catch(() => undefined);
    throw error;
  }
}));

adminContractsRouter.get('/:id/file', asyncHandler(async (req, res) => {
  const found = await pool.query<{ storage_ref: string }>('SELECT storage_ref FROM participant_contracts WHERE id=$1', [idOf(req.params.id)]);
  if (!found.rows[0]) throw notFound('Contract not found');
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename="contract.pdf"');
  await serveContractPdf(req,res,found.rows[0].storage_ref);
}));

adminContractsRouter.post('/:id/assign', asyncHandler(async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Enter a member email address.', parsed.error.flatten());
  const contractId = idOf(req.params.id);
  const member = await pool.query<{ id: number; email: string }>('SELECT id,email::text AS email FROM members WHERE lower(email::text)=$1 LIMIT 1', [parsed.data.email]);
  if (!member.rows[0]) throw notFound('No member has that email address. Invite them as a member first.');
  const exists = await pool.query('SELECT 1 FROM participant_contracts WHERE id=$1', [contractId]);
  if (!exists.rows[0]) throw notFound('Contract not found');
  const client = await pool.connect();
  let assigned: Awaited<ReturnType<typeof assignContract>> = null;
  try {
    await client.query('BEGIN');
    // The same function a purchase uses (services/offerContracts.ts): row, audit event and in-app notice.
    assigned = await assignContract(client,{ contractId, memberId:member.rows[0].id, adminId:Number(req.user?.sub) || undefined, ip:req.ip, userAgent:req.get('user-agent') });
    if (!assigned) throw badRequest('This contract is already assigned to that member.');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
  if (!assigned) throw badRequest('This contract is already assigned to that member.');
  void emailContractsAssigned({ memberId:member.rows[0].id, contracts:[assigned] });
  res.status(201).json({ id:assigned.assignmentId, memberEmail:member.rows[0].email, status:'pending' });
}));

adminContractsRouter.get('/assignments/:assignmentId/events', asyncHandler(async (req,res) => {
  const id = idOf(req.params.assignmentId);
  const found = await pool.query(`SELECT e.*,c.title,c.pdf_sha256,a.signed_name,a.signed_email,a.signed_at,a.evidence_sha256
    FROM participant_contract_events e JOIN participant_contract_assignments a ON a.id=e.assignment_id
    JOIN participant_contracts c ON c.id=a.contract_id WHERE e.assignment_id=$1 ORDER BY e.id`, [id]);
  if (!found.rows.length) throw notFound('Signing record not found');
  res.json({ events:found.rows, verification:verifyContractEvents(found.rows) });
}));

/* Offer links (QA row 164): the contracts an offer assigns automatically to whoever buys it. */
const offerIdOf = (raw: string): number => { const id = Number(raw); if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw badRequest('Invalid offer ID'); return id; };

adminContractsRouter.get('/offers/:offerId', asyncHandler(async (req,res) => {
  const offerId = offerIdOf(req.params.offerId);
  const offer = await pool.query('SELECT id FROM offers WHERE id=$1', [offerId]);
  if (!offer.rows[0]) throw notFound('Offer not found');
  const all = await pool.query<{ id: string; title: string }>('SELECT id,title FROM participant_contracts ORDER BY title,id');
  res.json({ offerId, linked: await contractsForOffer(offerId), contracts: all.rows.map(row => ({ id:Number(row.id), title:row.title })) });
}));

adminContractsRouter.put('/offers/:offerId', asyncHandler(async (req,res) => {
  const offerId = offerIdOf(req.params.offerId);
  const parsed = offerContractsSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Choose the contracts to attach to this offer.', parsed.error.flatten());
  const offer = await pool.query('SELECT id FROM offers WHERE id=$1', [offerId]);
  if (!offer.rows[0]) throw notFound('Offer not found');
  if (parsed.data.contractIds.length) {
    const found = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM participant_contracts WHERE id = ANY($1::bigint[])', [[...new Set(parsed.data.contractIds)]]);
    if ((found.rows[0]?.n ?? 0) !== new Set(parsed.data.contractIds).size) throw badRequest('One of those contracts no longer exists. Reload and try again.');
  }
  const linked = await setOfferContracts({ offerId, contractIds:parsed.data.contractIds, adminId:Number(req.user?.sub) || null });
  res.json({ offerId, linked });
}));

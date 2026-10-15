import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, notFound } from '../../utils/httpError';
import { isProtectedRef, protectedRef } from '../../services/signedUrls';
import { writeStoredMedia, removeStoredMedia } from '../../services/objectStorage';
import { appendContractEvent, verifyContractEvents } from '../../services/contractAudit';
import { readContractSource, serveContractPdf } from '../../services/contractStorage';

export const adminContractsRouter = Router();
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const idOf = (raw: string): number => { const id = Number(raw); if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid contract ID'); return id; };
const createSchema = z.object({ title: z.string().trim().min(3).max(200), mediaId: z.number().int().positive() });
const assignSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

adminContractsRouter.get('/', asyncHandler(async (_req, res) => {
  const docs = await pool.query(`SELECT c.id,c.title,c.pdf_sha256,c.created_at,
    count(a.id)::int AS assigned_count, count(a.id) FILTER (WHERE a.status='signed')::int AS signed_count
    FROM participant_contracts c LEFT JOIN participant_contract_assignments a ON a.contract_id=c.id
    GROUP BY c.id ORDER BY c.id DESC`);
  const assignments = await pool.query(`SELECT a.id,a.contract_id,a.status,a.assigned_at,a.signed_at,
    a.signed_name,a.signed_email,a.evidence_sha256,m.email AS member_email,m.name AS member_name
    FROM participant_contract_assignments a JOIN members m ON m.id=a.member_id ORDER BY a.id DESC`);
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query<{ id: number }>(`INSERT INTO participant_contract_assignments(contract_id,member_id)
      VALUES($1,$2) ON CONFLICT(contract_id,member_id) DO NOTHING RETURNING id`, [contractId,member.rows[0].id]);
    if (!row.rows[0]) throw badRequest('This contract is already assigned to that member.');
    const assignmentId = Number(row.rows[0].id);
    await appendContractEvent(client,assignmentId,{ type:'assigned',adminId:Number(req.user?.sub) || undefined,ip:req.ip,userAgent:req.get('user-agent'),data:{ contractId, memberId:member.rows[0].id } });
    await client.query('COMMIT');
    res.status(201).json({ id:assignmentId, memberEmail:member.rows[0].email, status:'pending' });
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}));

adminContractsRouter.get('/assignments/:assignmentId/events', asyncHandler(async (req,res) => {
  const id = idOf(req.params.assignmentId);
  const found = await pool.query(`SELECT e.*,c.title,c.pdf_sha256,a.signed_name,a.signed_email,a.signed_at,a.evidence_sha256
    FROM participant_contract_events e JOIN participant_contract_assignments a ON a.id=e.assignment_id
    JOIN participant_contracts c ON c.id=a.contract_id WHERE e.assignment_id=$1 ORDER BY e.id`, [id]);
  if (!found.rows.length) throw notFound('Signing record not found');
  res.json({ events:found.rows, verification:verifyContractEvents(found.rows) });
}));

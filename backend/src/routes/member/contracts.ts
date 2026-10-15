import { Router, type Request } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, notFound, unauthorized } from '../../utils/httpError';
import { serveContractPdf } from '../../services/contractStorage';
import { appendContractEvent, DISCLOSURE_VERSION, ELECTRONIC_CONSENT, SIGNING_INTENT } from '../../services/contractAudit';
import { denyImpersonation } from '../../middleware/memberAuth';

export const memberContractsRouter = Router();
const memberIdOf = (req: Request): number => { if (!req.member) throw unauthorized('Sign in to view contracts'); return req.member.id; };
const idOf = (raw: string): number => { const id = Number(raw); if (!Number.isSafeInteger(id) || id <= 0) throw badRequest('Invalid contract ID'); return id; };
const signSchema = z.object({ typedName: z.string().trim().min(3).max(200), electronicConsent: z.literal(true), signingIntent: z.literal(true) });
const SELECT = `SELECT a.id,a.status,a.assigned_at,a.signed_at,a.signed_name,a.signed_email,a.signer_ip,a.signer_user_agent,a.evidence_sha256,a.disclosure_version,
 c.title,c.storage_ref,c.pdf_sha256,c.created_at,m.email::text AS member_email
 FROM participant_contract_assignments a JOIN participant_contracts c ON c.id=a.contract_id
 JOIN members m ON m.id=a.member_id`;

memberContractsRouter.get('/contracts', asyncHandler(async (req,res) => {
  const rows = await pool.query(`${SELECT} WHERE a.member_id=$1 ORDER BY a.id DESC`, [memberIdOf(req)]);
  res.json({ contracts: rows.rows.map(({storage_ref, ...row}) => ({...row,id:Number(row.id)})), disclosure: ELECTRONIC_CONSENT, intent: SIGNING_INTENT, disclosureVersion: DISCLOSURE_VERSION });
}));

memberContractsRouter.get('/contracts/:id/file', asyncHandler(async (req,res) => {
  const memberId = memberIdOf(req);
  const assignmentId = idOf(req.params.id);
  const client = await pool.connect();
  let reference: string;
  try {
    await client.query('BEGIN');
    const result = await client.query<{ storage_ref: string; pdf_sha256: string }>(`${SELECT} WHERE a.id=$1 AND a.member_id=$2 FOR UPDATE OF a`, [assignmentId,memberId]);
    if (!result.rows[0]) throw notFound('Contract not found');
    reference = result.rows[0].storage_ref;
    await appendContractEvent(client,assignmentId,{type:'viewed',memberId,ip:req.ip,userAgent:req.get('user-agent'),data:{pdfSha256:result.rows[0].pdf_sha256}});
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename="contract.pdf"');
  await serveContractPdf(req,res,reference!);
}));

memberContractsRouter.post('/contracts/:id/sign', denyImpersonation, asyncHandler(async (req,res) => {
  const memberId = memberIdOf(req);
  const assignmentId = idOf(req.params.id);
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Review the document, enter your full name, and confirm both statements.', parsed.error.flatten());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id:number; status:string; pdf_sha256:string; member_email:string; title:string }>(`${SELECT} WHERE a.id=$1 AND a.member_id=$2 FOR UPDATE OF a`,[assignmentId,memberId]);
    const assignment = result.rows[0];
    if (!assignment) throw notFound('Contract not found');
    if (assignment.status !== 'pending') throw badRequest('This contract has already been signed.');
    const signedAt = new Date().toISOString();
    const ip = (req.ip ?? '').slice(0,100);
    const userAgent = (req.get('user-agent') ?? '').slice(0,500);
    const evidenceHash = await appendContractEvent(client,assignmentId,{type:'signed',memberId,ip,userAgent,data:{pdfSha256:assignment.pdf_sha256,typedName:parsed.data.typedName,email:assignment.member_email,disclosureVersion:DISCLOSURE_VERSION,disclosureText:ELECTRONIC_CONSENT,intentText:SIGNING_INTENT,electronicConsent:true,signingIntent:true,signedAt}});
    await client.query(`UPDATE participant_contract_assignments SET status='signed',signed_at=$2,
      signed_name=$3,signed_email=$4,signer_ip=$5,signer_user_agent=$6,disclosure_version=$7,evidence_sha256=$8 WHERE id=$1`,
      [assignmentId,signedAt,parsed.data.typedName,assignment.member_email,ip,userAgent,DISCLOSURE_VERSION,evidenceHash]);
    await client.query('COMMIT');
    res.json({ id:assignmentId,status:'signed',signedAt,evidenceSha256:evidenceHash });
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}));

memberContractsRouter.get('/contracts/:id/evidence', asyncHandler(async (req,res) => {
  const result = await pool.query(`${SELECT} WHERE a.id=$1 AND a.member_id=$2`,[idOf(req.params.id),memberIdOf(req)]);
  const row = result.rows[0];
  if (!row || row.status !== 'signed') throw notFound('Signing record not found');
  const events = await pool.query('SELECT event_type,occurred_at,ip,user_agent,event_hash,previous_hash,event_data FROM participant_contract_events WHERE assignment_id=$1 ORDER BY id',[row.id]);
  const signedEvent = events.rows.find(event => event.event_type === 'signed');
  const signedData = signedEvent?.event_data ?? {};
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="contract-signing-record-${row.id}.pdf"`);
  res.setHeader('Cache-Control','private, no-store');
  const pdf = new PDFDocument({margin:50});
  pdf.pipe(res);
  pdf.fontSize(18).text('Boss Clinician signing record').moveDown();
  pdf.fontSize(10).text(`Contract: ${row.title}`).text(`Original PDF SHA-256: ${row.pdf_sha256}`).moveDown();
  pdf.text(`Signed by: ${row.signed_name} (${row.signed_email})`)
    .text(`Signed at (UTC): ${new Date(row.signed_at).toISOString()}`)
    .text(`Disclosure version: ${row.disclosure_version || signedData.disclosureVersion || 'Unavailable'}`)
    .text(`Signer IP: ${row.signer_ip || 'Unavailable'}`)
    .text(`Browser: ${row.signer_user_agent || 'Unavailable'}`).moveDown();
  pdf.text(signedData.disclosureText || ELECTRONIC_CONSENT).moveDown().text(signedData.intentText || SIGNING_INTENT).moveDown();
  pdf.text(`Final audit hash: ${row.evidence_sha256}`).moveDown();
  pdf.fontSize(12).text('Audit events').moveDown(0.5);
  for (const event of events.rows) pdf.fontSize(9).text(`${event.event_type} | ${new Date(event.occurred_at).toISOString()} | ${event.event_hash}`);
  pdf.end();
}));

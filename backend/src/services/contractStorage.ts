import fs from 'fs/promises';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { readStoredMedia, serveStoredMedia } from './objectStorage';
import { resolveStoredFile } from './signedUrls';

export async function readContractSource(reference: string, limit: number): Promise<Buffer | null> {
  if (env.mediaStorage.store === 's3') return readStoredMedia(reference,limit);
  const filename = await resolveStoredFile(reference);
  if (!filename) return null;
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size <= 0 || stat.size > limit) return null;
  return fs.readFile(filename);
}

export async function serveContractPdf(req: Request, res: Response, reference: string): Promise<void> {
  if (env.mediaStorage.store === 's3') { await serveStoredMedia(req,res,reference); return; }
  const filename = await resolveStoredFile(reference);
  if (!filename) { res.sendStatus(404); return; }
  await new Promise<void>((resolve,reject) => res.sendFile(filename, { headers: { 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Content-Type':'application/pdf' } }, (error) => error ? reject(error) : resolve()));
}

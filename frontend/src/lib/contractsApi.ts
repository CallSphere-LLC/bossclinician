import { sessionFetch } from '@/lib/adminTransport';
import { adminApi, API_BASE } from '@/lib/api';
import { memberRequest, memberFetch } from '@/lib/memberApi';

/** An offer that assigns this contract automatically to whoever buys it. */
export interface ContractOfferLink { id: number; title: string; status: string }
export interface Contract { id: number; title: string; pdf_sha256: string; created_at: string; assigned_count: number; signed_count: number; offers?: ContractOfferLink[] }
export interface ContractAssignment { id: number; contract_id: number; status: 'pending' | 'signed'; assigned_at: string; signed_at: string | null; member_email: string; member_name: string; signed_name: string | null; evidence_sha256: string | null; source_order_id?: number | null; source_offer_title?: string | null }
export interface MemberContract { id: number; status: 'pending' | 'signed'; title: string; assigned_at: string; signed_at: string | null; signed_name: string | null; pdf_sha256: string; evidence_sha256: string | null; source_offer_title?: string | null }
export interface OfferContracts { offerId: number; linked: Array<{ id: number; title: string }>; contracts: Array<{ id: number; title: string }> }

async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type':'application/json', ...(init.headers ?? {}) } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Could not save the contract.'); }
  return response.json() as Promise<T>;
}

export const adminContractsApi = {
  list: () => adminRequest<{ contracts: Contract[]; assignments: ContractAssignment[] }>('/admin/contracts'),
  create: async (title: string, file: File) => {
    if (file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
    const media = await adminApi.uploadMedia(file, 'protected');
    return adminRequest<Contract>('/admin/contracts', {method:'POST',body:JSON.stringify({title,mediaId:media.id})});
  },
  assign: (contractId: number, email: string) => adminRequest<ContractAssignment>(`/admin/contracts/${contractId}/assign`, {method:'POST',body:JSON.stringify({email})}),
  events: (assignmentId: number) => adminRequest<{events: Array<Record<string, unknown>>; verification: {valid:boolean;checked:number;firstInvalidIndex:number|null}}>(`/admin/contracts/assignments/${assignmentId}/events`),
  fileUrl: (contractId: number) => `${API_BASE}/admin/contracts/${contractId}/file`,
  /** The contracts an offer assigns on purchase, and every contract that could be picked. */
  forOffer: (offerId: number) => adminRequest<OfferContracts>(`/admin/contracts/offers/${offerId}`),
  setForOffer: (offerId: number, contractIds: number[]) => adminRequest<Pick<OfferContracts, 'offerId' | 'linked'>>(`/admin/contracts/offers/${offerId}`, {method:'PUT',body:JSON.stringify({contractIds})}),
};

export const memberContractsApi = {
  list: () => memberRequest<{contracts: MemberContract[]; disclosure: string; intent: string; disclosureVersion: string}>('/member/contracts'),
  sign: (id: number, typedName: string) => memberRequest<{id:number;status:string;signedAt:string}>(`/member/contracts/${id}/sign`, {method:'POST',body:JSON.stringify({typedName,electronicConsent:true,signingIntent:true})}),
  file: (id: number) => memberFetch(`/member/contracts/${id}/file`),
  evidence: (id: number) => memberFetch(`/member/contracts/${id}/evidence`),
};

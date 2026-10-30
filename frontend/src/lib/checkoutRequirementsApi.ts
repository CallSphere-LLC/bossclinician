import { sessionFetch } from "@/lib/adminTransport";
import { API_BASE } from "@/lib/api";

/** Admin for what an offer requires before payment (QA rows 202 and 203). */

export interface AdminAcknowledgment {
  key?: string;
  version?: number;
  text: string;
  linkLabel: string;
  linkUrl: string;
  active: boolean;
}

export interface RequirementSettingsInput {
  acknowledgments: AdminAcknowledgment[];
  requiredContractIds: number[];
  invitationRequired: boolean;
  programTerm: string;
  termMonths: number | null;
  includedBenefits: string;
  refundTerms: string;
  refundWindowDays: number | null;
  obligationsNote: string;
}

export interface EnrollmentInvitation {
  id: number;
  email: string;
  full_name: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  completed_order_id: number | null;
  completed_at: string | null;
}

export interface OfferRequirementsResponse extends RequirementSettingsInput {
  offer: { id: number; slug: string; title: string; status: string };
  contracts: Array<{ id: number; title: string }>;
  livePaymentLinks: number;
  invitations: EnrollmentInvitation[];
}

export interface CheckoutSignature {
  id: number;
  order_id: number | null;
  offer_title: string;
  contract_id: number;
  contract_title: string;
  signed_name: string;
  signed_email: string;
  signed_at: string;
  copy_emailed_at: string | null;
  order_status: string | null;
  total_investment: string | null;
  payment_arrangement: string | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await sessionFetch(`${API_BASE}/admin/contracts${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Could not save. Please try again.");
  }
  return response.json() as Promise<T>;
}

export const checkoutRequirementsApi = {
  get: (offerId: number) => request<OfferRequirementsResponse>(`/offers/${offerId}/requirements`),
  save: (offerId: number, input: RequirementSettingsInput) =>
    request<RequirementSettingsInput>(`/offers/${offerId}/requirements`, { method: "PUT", body: JSON.stringify(input) }),
  invite: (offerId: number, email: string, fullName: string) =>
    request<{ id: number; link: string; emailed: boolean; invitations: EnrollmentInvitation[] }>(`/offers/${offerId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, fullName }),
    }),
  revoke: (offerId: number, invitationId: number) =>
    request<{ invitations: EnrollmentInvitation[] }>(`/offers/${offerId}/invitations/${invitationId}/revoke`, { method: "POST", body: "{}" }),
  signatures: () => request<{ signatures: CheckoutSignature[] }>("/signatures"),
  record: (id: number) => sessionFetch(`${API_BASE}/admin/contracts/signatures/${id}/record`),
};

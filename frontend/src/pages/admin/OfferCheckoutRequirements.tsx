import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ClipboardCheck, FileSignature, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { adminContractsApi } from "@/lib/contractsApi";
import {
  checkoutRequirementsApi,
  type AdminAcknowledgment,
  type CheckoutSignature,
  type EnrollmentInvitation,
  type OfferRequirementsResponse,
} from "@/lib/checkoutRequirementsApi";
import { Badge, Button, Card, CardHeader, ErrorNotice, Field, Input, Skeleton, Textarea, legibleDisabledStyles } from "@/pages/admin/ui/primitives";

/**
 * The offer's "before payment" settings (QA rows 202 and 203), below the
 * post-purchase contracts on the Contract tab. Its own endpoint and Save button,
 * like that tab. Everything starts off: a box only reaches buyers once "Live at
 * checkout" is ticked and saved, and an agreement only once it is ticked and
 * saved here.
 */

const blankBox: AdminAcknowledgment = { text: "", linkLabel: "", linkUrl: "", active: false };

function invitationStatus(invitation: EnrollmentInvitation): { label: string; tone: "green" | "neutral" } {
  if (invitation.completed_at) return { label: `Enrolled, order ${invitation.completed_order_id ?? ""}`.trim(), tone: "green" };
  if (invitation.revoked_at) return { label: "Replaced or cancelled", tone: "neutral" };
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return { label: "Expired", tone: "neutral" };
  return { label: "Waiting for them", tone: "neutral" };
}

export default function OfferCheckoutRequirements({ offerId }: { offerId: number }) {
  const [data, setData] = useState<OfferRequirementsResponse | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [boxes, setBoxes] = useState<AdminAcknowledgment[]>([]);
  const [required, setRequired] = useState<number[]>([]);
  const [invitationRequired, setInvitationRequired] = useState(false);
  const [programTerm, setProgramTerm] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [includedBenefits, setIncludedBenefits] = useState("");
  const [refundTerms, setRefundTerms] = useState("");
  const [refundWindowDays, setRefundWindowDays] = useState("");
  const [obligationsNote, setObligationsNote] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invitations, setInvitations] = useState<EnrollmentInvitation[]>([]);
  const [lastLink, setLastLink] = useState("");

  useEffect(() => {
    let live = true;
    checkoutRequirementsApi
      .get(offerId)
      .then((loaded) => {
        if (!live) return;
        setData(loaded);
        setBoxes(loaded.acknowledgments);
        setRequired(loaded.requiredContractIds);
        setInvitationRequired(loaded.invitationRequired);
        setProgramTerm(loaded.programTerm);
        setTermMonths(loaded.termMonths === null ? "" : String(loaded.termMonths));
        setIncludedBenefits(loaded.includedBenefits);
        setRefundTerms(loaded.refundTerms);
        setRefundWindowDays(loaded.refundWindowDays === null ? "" : String(loaded.refundWindowDays));
        setObligationsNote(loaded.obligationsNote);
        setInvitations(loaded.invitations);
        setError("");
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load the checkout requirements.");
      });
    return () => {
      live = false;
    };
  }, [offerId]);

  function patchBox(index: number, patch: Partial<AdminAcknowledgment>) {
    setBoxes((current) => current.map((box, i) => (i === index ? { ...box, ...patch } : box)));
  }

  async function uploadLinkFile(index: number, file: File | undefined) {
    if (!file) return;
    try {
      const asset = await adminApi.uploadMedia(file, "public");
      patchBox(index, { linkUrl: asset.url });
      toast.success("File uploaded. Press Save to use it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload that file.");
    }
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await checkoutRequirementsApi.save(offerId, {
        acknowledgments: boxes,
        requiredContractIds: required,
        invitationRequired,
        programTerm,
        termMonths: termMonths.trim() ? Number(termMonths) : null,
        includedBenefits,
        refundTerms,
        refundWindowDays: refundWindowDays.trim() ? Number(refundWindowDays) : null,
        obligationsNote,
      });
      setBoxes(saved.acknowledgments);
      setRequired(saved.requiredContractIds);
      toast.success("Saved. Use Preview checkout to see it as a buyer will.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function invite() {
    setInviting(true);
    try {
      const result = await checkoutRequirementsApi.invite(offerId, inviteEmail, inviteName);
      setInvitations(result.invitations);
      setLastLink(result.link);
      setInviteEmail("");
      setInviteName("");
      if (result.emailed) toast.success("Invitation emailed");
      else toast.error("The email did not send. Copy the link below and send it yourself.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the invitation.");
    } finally {
      setInviting(false);
    }
  }

  async function revoke(id: number) {
    try {
      setInvitations((await checkoutRequirementsApi.revoke(offerId, id)).invitations);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the invitation.");
    }
  }

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Skeleton className="h-40 w-full" />;

  return (
    <Card>
      <CardHeader
        icon={<ClipboardCheck className="size-4" />}
        title="Before payment"
        subtitle="Required boxes and agreements at checkout. Off until you switch them on here."
        action={
          <Button type="button" size="sm" className={legibleDisabledStyles} onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        }
      />
      <div className="space-y-8 p-5">
        {data.livePaymentLinks > 0 && (
          <ErrorNotice message="This offer has a live Stripe payment link, which skips the checkout page. Deactivate it on the Price tab before switching anything on here." />
        )}

        <section className="space-y-3">
          <div>
            <h3 className="font-semibold text-ink">Checkout boxes</h3>
            <p className="text-sm text-ink-soft">
              Write each statement in your own words and add a link if it points to a document. Buyers must tick every live box before paying, and the exact wording they ticked is saved on their order. Changing the wording starts a new version for later buyers.
            </p>
          </div>
          {boxes.map((box, index) => (
            <div key={box.key ?? `new-${index}`} className="space-y-3 rounded-xl border border-hairline p-4">
              <Field label="Statement beside the box">
                <Textarea value={box.text} rows={2} maxLength={2000} onChange={(e) => patchBox(index, { text: e.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Link text" hint="optional">
                  <Input value={box.linkLabel} maxLength={120} onChange={(e) => patchBox(index, { linkLabel: e.target.value })} />
                </Field>
                <Field label="Link address" hint="/terms or https://…">
                  <Input value={box.linkUrl} maxLength={2000} onChange={(e) => patchBox(index, { linkUrl: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <input type="checkbox" className="size-4" checked={box.active} onChange={(e) => patchBox(index, { active: e.target.checked })} />
                    Live at checkout
                  </label>
                  <label className="cursor-pointer text-sm text-plum-deep underline">
                    Upload a PDF for the link
                    <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void uploadLinkFile(index, e.target.files?.[0])} />
                  </label>
                  {box.version && <span className="text-xs text-ink-soft">Version {box.version}</span>}
                </div>
                <Button type="button" size="sm" variant="dangerGhost" onClick={() => setBoxes((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setBoxes((current) => [...current, { ...blankBox }])}>
            <Plus /> Add a box
          </Button>
        </section>

        <section className="space-y-3 border-t border-hairline pt-6">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-ink"><FileSignature className="size-4" /> Agreement to sign before paying</h3>
            <p className="text-sm text-ink-soft">
              Only tick an agreement your attorney has approved. Buyers read the PDF, see the enrollment record below with their own payment option, and sign before they can pay. They are emailed a copy once payment succeeds, and renewals never ask again.
              To issue an updated version, upload it as a new contract in <Link className="text-plum-deep underline" to="/admin/contracts">Products → Contracts</Link>, tick it here and untick the old one. Assign it there to anyone already enrolled who needs to re-accept.
            </p>
          </div>
          {data.contracts.length === 0 ? (
            <p className="text-sm text-ink-soft">No contracts uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {data.contracts.map((contract) => (
                <label key={contract.id} className="flex items-start gap-3 rounded-xl border border-hairline px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={required.includes(contract.id)}
                    onChange={(e) => setRequired((current) => (e.target.checked ? [...current, contract.id] : current.filter((id) => id !== contract.id)))}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{contract.title}</span>
                    <a className="text-xs text-plum-deep underline" href={adminContractsApi.fileUrl(contract.id)} target="_blank" rel="noreferrer">View PDF</a>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Program term" hint="required with an agreement">
              <Input value={programTerm} maxLength={500} onChange={(e) => setProgramTerm(e.target.value)} />
            </Field>
            <Field label="Term length in months" hint="optional; records the end date">
              <Input type="number" min={1} max={120} value={termMonths} onChange={(e) => setTermMonths(e.target.value)} />
            </Field>
            <Field label="Refund window in days" hint="optional; records the deadline">
              <Input type="number" min={0} max={365} value={refundWindowDays} onChange={(e) => setRefundWindowDays(e.target.value)} />
            </Field>
          </div>
          <Field label="Refund terms" hint="required with an agreement">
            <Textarea rows={3} maxLength={5000} value={refundTerms} onChange={(e) => setRefundTerms(e.target.value)} />
          </Field>
          <Field label="Included benefits" hint="optional">
            <Textarea rows={3} maxLength={5000} value={includedBenefits} onChange={(e) => setIncludedBenefits(e.target.value)} />
          </Field>
          <Field label="Further payment terms" hint="optional; shown under remaining obligations">
            <Textarea rows={2} maxLength={5000} value={obligationsNote} onChange={(e) => setObligationsNote(e.target.value)} />
          </Field>
          <p className="text-xs text-ink-soft">The total, payment arrangement, amount due today and remaining payments are filled in from this offer's prices. They are not typed here.</p>
        </section>

        <section className="space-y-3 border-t border-hairline pt-6">
          <div>
            <h3 className="font-semibold text-ink">Invitation only</h3>
            <p className="text-sm text-ink-soft">For programs you approve applicants to. When this is on, the public checkout page says enrollment is by invitation, and only someone with their personal link can pay, using the email you invited.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" className="size-4" checked={invitationRequired} onChange={(e) => setInvitationRequired(e.target.checked)} />
            Only invited applicants can check out
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Applicant's email">
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </Field>
            <Field label="Applicant's name" hint="optional">
              <Input value={inviteName} maxLength={200} onChange={(e) => setInviteName(e.target.value)} />
            </Field>
            <Button type="button" className={legibleDisabledStyles} variant="secondary" disabled={inviting || !inviteEmail.trim()} onClick={() => void invite()}>
              <Send /> {inviting ? "Sending…" : "Email approval link"}
            </Button>
          </div>
          {lastLink && (
            <p className="break-all rounded-lg border border-hairline p-3 text-xs text-ink-soft">
              Their personal link, shown once: {lastLink}
            </p>
          )}
          {invitations.length > 0 && (
            <ul className="space-y-2">
              {invitations.map((invitation) => {
                const status = invitationStatus(invitation);
                const open = !invitation.completed_at && !invitation.revoked_at && new Date(invitation.expires_at).getTime() > Date.now();
                return (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline px-4 py-3 text-sm">
                    <span className="min-w-0 break-all text-ink">{invitation.full_name ? `${invitation.full_name}, ` : ""}{invitation.email}</span>
                    <span className="flex items-center gap-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {open && <button type="button" className="text-sm text-plum-deep underline" onClick={() => void revoke(invitation.id)}>Cancel</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

/** Products → Contracts: every agreement signed at checkout, with its full record. */
export function CheckoutSignaturesSection() {
  const [signatures, setSignatures] = useState<CheckoutSignature[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    checkoutRequirementsApi
      .signatures()
      .then((data) => setSignatures(data.signatures))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load signed agreements."));
  }, []);

  const download = useCallback(async (id: number) => {
    try {
      const response = await checkoutRequirementsApi.record(id);
      if (!response.ok) throw new Error("Could not download the signing record.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `signing-record-${id}.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download the signing record.");
    }
  }, []);

  return (
    <Card>
      <CardHeader icon={<FileSignature />} title="Signed at checkout" subtitle="Agreements buyers signed before paying, with the payment terms they accepted" />
      <div className="p-5">
        {error && <ErrorNotice message={error} />}
        {!error && signatures === null && <Skeleton className="h-16 w-full" />}
        {signatures?.length === 0 && <p className="text-sm text-ink-soft">No agreements have been signed at checkout yet.</p>}
        {signatures && signatures.length > 0 && (
          <ul className="space-y-3">
            {signatures.map((signature) => (
              <li key={signature.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{signature.signed_name} · {signature.signed_email}</p>
                  <p className="text-sm text-ink-soft">{signature.contract_title} · {signature.offer_title}</p>
                  <p className="text-xs text-ink-soft">
                    {new Date(signature.signed_at).toLocaleString()} · {signature.payment_arrangement ?? ""} · Order {signature.order_id ?? "removed"}
                    {signature.order_status ? ` (${signature.order_status})` : ""}
                    {signature.copy_emailed_at ? " · Copy emailed" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <a className="text-plum-deep underline" href={adminContractsApi.fileUrl(signature.contract_id)} target="_blank" rel="noreferrer">Agreement PDF</a>
                  <button type="button" className="text-plum-deep underline" onClick={() => void download(signature.id)}>Signing record</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

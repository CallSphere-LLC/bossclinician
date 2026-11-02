import { useEffect, useState } from "react";
import { FileSignature, ShieldCheck } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { commerceErrorMessage, type CheckoutInput, type CheckoutRequirements, type EnrollmentTermsView, type PublicOffer } from "@/lib/commerceApi";
import { memberRequest } from "@/lib/memberApi";

/**
 * What the owner asks of a buyer before payment (QA rows 202 and 203): her own
 * acknowledgment boxes, an agreement to read and sign beside the enrollment
 * record, and an invitation for programs she approves applicants to.
 *
 * Kept out of the order form so the form only has to spread `payload` into its
 * request and call `validate()`. An offer with nothing switched on has
 * `checkoutRequirements: null`, and the form draws what it always drew. The
 * server enforces every one of these again; this file only asks nicely first.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export function invitationTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.search).get("invite");
  return token && token.length >= 20 && token.length <= 200 ? token : null;
}

/** True when this visitor should see the invitation notice instead of the form. */
export function usesInvitationGate(offer: PublicOffer, preview: boolean): boolean {
  return !preview && !offer.cartItems && Boolean(offer.checkoutRequirements?.invitationRequired) && invitationTokenFromUrl() === null;
}

/** Where to apply, for a by-invitation offer that takes applications on the site. */
const APPLICATION_LINKS: Record<string, { label: string; to: string }> = {
  "the-boss-boardroom": { label: "Apply for The Boardroom", to: "/boardroom#apply" },
};

export function InvitationRequiredNotice({ offerSlug }: { offerSlug: string }) {
  const application = APPLICATION_LINKS[offerSlug];
  return (
    <GlassCard accent="plum" interactive={false} className="mx-auto max-w-xl px-6 py-10 text-center sm:px-10">
      <h2 className="font-display text-[1.8rem] leading-tight text-white">Enrollment is by invitation</h2>
      <p className="copy-luxe mt-4">
        Once your application is approved, you'll receive a personal link to review your agreement and enroll. Questions? Email{" "}
        <a className="text-gold underline underline-offset-4" href="mailto:support@bossclinician.com">support@bossclinician.com</a>.
      </p>
      {application && (
        <LuxeButton variant="foil" to={application.to} className="mt-8 min-h-[44px]">
          {application.label}
        </LuxeButton>
      )}
    </GlassCard>
  );
}

interface AgreementDraft {
  opened: boolean;
  typedName: string;
  consent: boolean;
  intent: boolean;
}

const EMPTY_DRAFT: AgreementDraft = { opened: false, typedName: "", consent: false, intent: false };

export interface CheckoutRequirementsState {
  requirements: CheckoutRequirements | null;
  active: boolean;
  blocksGift: boolean;
  preview: boolean;
  invitationToken: string | null;
  invitedEmail: string | null;
  invitationError: string | null;
  terms: EnrollmentTermsView | null;
  ticks: Record<string, boolean>;
  drafts: Record<number, AgreementDraft>;
  errors: Record<string, string>;
  setTick: (key: string, value: boolean) => void;
  setDraft: (contractId: number, patch: Partial<AgreementDraft>) => void;
  validate: () => boolean;
  payload: Pick<CheckoutInput, "checkoutAcknowledgments" | "agreementSignatures" | "invitationToken" | "buyerTimeZone">;
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function draftIsComplete(draft: AgreementDraft): boolean {
  return draft.opened && draft.consent && draft.intent && draft.typedName.trim().length >= 3;
}

export function useCheckoutRequirements(input: {
  offer: PublicOffer;
  pricingOptionId: number | null;
  /** The chosen option's kind: a box can be written for one kind of payment only. */
  pricingType?: string;
  preview: boolean;
}): CheckoutRequirementsState {
  const { offer, pricingOptionId, pricingType, preview } = input;
  // A cart refuses these offers on the server, so its form has nothing to ask.
  const offered = offer.cartItems ? null : offer.checkoutRequirements ?? null;
  const requirements = offered && {
    ...offered,
    acknowledgments: offered.acknowledgments.filter((item) => !item.appliesTo || item.appliesTo === pricingType),
  };

  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, AgreementDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [invitationToken] = useState<string | null>(() => (preview ? null : invitationTokenFromUrl()));
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const invitationRequired = requirements?.invitationRequired ?? false;

  useEffect(() => {
    if (!invitationRequired || !invitationToken) return;
    let live = true;
    memberRequest<{ email: string }>(`/checkout/invitations/${encodeURIComponent(invitationToken)}`)
      .then((invitation) => {
        if (live) setInvitedEmail(invitation.email);
      })
      .catch((err: unknown) => {
        if (live) setInvitationError(commerceErrorMessage(err, "This invitation link is no longer available."));
      });
    return () => {
      live = false;
    };
  }, [invitationRequired, invitationToken]);

  function clearError(key: string) {
    setErrors((current) => (current[key] ? { ...current, [key]: "" } : current));
  }

  function validate(): boolean {
    if (!requirements) return true;
    const next: Record<string, string> = {};
    for (const item of requirements.acknowledgments) {
      if (!ticks[item.key]) next[`ack:${item.key}`] = "Please tick this box to continue.";
    }
    for (const agreement of requirements.agreements) {
      const draft = drafts[agreement.contractId] ?? EMPTY_DRAFT;
      if (!draft.opened) next[`agreement:${agreement.contractId}`] = "Open and read the agreement before signing.";
      else if (!draftIsComplete(draft)) next[`agreement:${agreement.contractId}`] = "Type your full legal name and tick both statements to sign.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  const payload: CheckoutRequirementsState["payload"] = requirements
    ? {
        ...(requirements.acknowledgments.length > 0
          ? { checkoutAcknowledgments: requirements.acknowledgments.filter((item) => ticks[item.key]).map(({ key, version }) => ({ key, version })) }
          : {}),
        ...(requirements.agreements.length > 0
          ? {
              agreementSignatures: requirements.agreements.flatMap((agreement) => {
                const draft = drafts[agreement.contractId] ?? EMPTY_DRAFT;
                return draftIsComplete(draft)
                  ? [{ contractId: agreement.contractId, typedName: draft.typedName.trim(), electronicConsent: true as const, signingIntent: true as const }]
                  : [];
              }),
              buyerTimeZone: browserTimeZone(),
            }
          : {}),
        ...(invitationRequired && invitationToken ? { invitationToken } : {}),
      }
    : {};

  const terms = requirements
    ? (requirements.enrollment.find((entry) => entry.optionId === pricingOptionId) ?? requirements.enrollment[0])?.terms ?? null
    : null;

  return {
    requirements,
    active: requirements !== null && (requirements.acknowledgments.length > 0 || requirements.agreements.length > 0 || invitationError !== null),
    blocksGift: requirements !== null && (requirements.agreements.length > 0 || requirements.invitationRequired),
    preview,
    invitationToken,
    invitedEmail,
    invitationError,
    terms,
    ticks,
    drafts,
    errors,
    setTick: (key, value) => {
      setTicks((current) => ({ ...current, [key]: value }));
      clearError(`ack:${key}`);
    },
    setDraft: (contractId, patch) => {
      setDrafts((current) => ({ ...current, [contractId]: { ...(current[contractId] ?? EMPTY_DRAFT), ...patch } }));
      clearError(`agreement:${contractId}`);
    },
    validate,
    payload,
  };
}

function RecordRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-orchid-dim">{label}</dt>
      <dd className={strong ? "whitespace-pre-line font-bold tabular-nums text-white" : "whitespace-pre-line text-orchid"}>{value}</dd>
    </div>
  );
}

function EnrollmentRecord({ terms }: { terms: EnrollmentTermsView }) {
  return (
    <dl className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm leading-relaxed">
      <RecordRow label="Program" value={terms.offerTitle} />
      <RecordRow label="Program term" value={terms.programTerm} />
      <RecordRow label="Total investment" value={terms.totalInvestment} strong />
      <RecordRow label="Payment arrangement" value={terms.paymentArrangement} />
      <RecordRow label="Due today" value={terms.dueToday} strong />
      <RecordRow label="Payment dates" value={terms.paymentDates ?? ""} />
      <RecordRow label="Remaining obligations" value={terms.remainingObligations} />
      <RecordRow label="Further payment terms" value={terms.obligationsNote} />
      <RecordRow label="Included benefits" value={terms.includedBenefits} />
      <RecordRow label="Refund terms" value={terms.refundTerms} />
      <RecordRow label="Refund deadline" value={terms.refundDeadlineRule ?? ""} />
    </dl>
  );
}

const CHECK_CLASS = "mt-0.5 size-4 flex-none accent-[#c9a46a]";

export function CheckoutRequirementsPanel({
  state,
  offerSlug,
  disabled,
}: {
  state: CheckoutRequirementsState;
  offerSlug: string;
  disabled: boolean;
}) {
  const { requirements, errors, drafts, ticks, terms, preview, invitationToken } = state;
  if (!requirements) return null;

  function fileUrl(contractId: number): string {
    // The preview runs on the admin host, which serves the owner's own copy.
    if (preview) return `${API_BASE}/admin/contracts/${contractId}/file`;
    const invite = invitationToken ? `?invite=${encodeURIComponent(invitationToken)}` : "";
    return `${API_BASE}/checkout/offer/${encodeURIComponent(offerSlug)}/agreements/${contractId}/file${invite}`;
  }

  return (
    <div className="space-y-6">
      {state.invitationError && (
        <p role="alert" className="rounded-xl border border-red-400/40 bg-red-500/[0.08] px-4 py-3.5 text-sm leading-relaxed text-red-200">
          {state.invitationError}
        </p>
      )}

      {requirements.agreements.map((agreement) => {
        const draft = drafts[agreement.contractId] ?? EMPTY_DRAFT;
        const error = errors[`agreement:${agreement.contractId}`];
        return (
          <section key={agreement.contractId} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <FileSignature aria-hidden className="size-4 text-gold" />
              Review and sign: {agreement.title}
            </h3>
            {terms && <EnrollmentRecord terms={terms} />}
            <p className="text-sm text-orchid">
              <a
                href={fileUrl(agreement.contractId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => state.setDraft(agreement.contractId, { opened: true })}
                className="font-semibold text-gold underline underline-offset-4 hover:text-gold-bright"
              >
                Read the full agreement (PDF)
              </a>{" "}
              {draft.opened ? "Opened." : "Please read every page before signing."}
            </p>
            <label className="flex items-start gap-3 text-sm leading-relaxed text-orchid">
              <input type="checkbox" className={CHECK_CLASS} checked={draft.consent} disabled={disabled} onChange={(e) => state.setDraft(agreement.contractId, { consent: e.target.checked })} />
              <span>{requirements.disclosure}</span>
            </label>
            <label className="flex items-start gap-3 text-sm leading-relaxed text-orchid">
              <input type="checkbox" className={CHECK_CLASS} checked={draft.intent} disabled={disabled} onChange={(e) => state.setDraft(agreement.contractId, { intent: e.target.checked })} />
              <span>{requirements.intent}</span>
            </label>
            <LuxeInput
              label="Type your full legal name to sign"
              required
              autoComplete="name"
              maxLength={200}
              value={draft.typedName}
              disabled={disabled}
              hint="Your name, email, the time, your IP address and browser are kept with this document and the payment terms above. You'll receive a copy by email once your enrollment is complete."
              onChange={(e) => state.setDraft(agreement.contractId, { typedName: e.target.value })}
            />
            {draftIsComplete(draft) && (
              <p className="flex items-center gap-2 text-sm text-gold">
                <ShieldCheck aria-hidden className="size-4" />
                Ready. Your signature is recorded when you continue below, before any payment is taken.
              </p>
            )}
            {error && <p role="alert" className="text-xs font-medium text-red-400">{error}</p>}
          </section>
        );
      })}

      {requirements.agreements.length === 0 && terms && <EnrollmentRecord terms={terms} />}

      {requirements.acknowledgments.length > 0 && (
        <div className="space-y-3">
          {requirements.acknowledgments.map((item) => {
            const error = errors[`ack:${item.key}`];
            return (
              <div key={item.key}>
                <label className="flex items-start gap-3 text-sm leading-relaxed text-orchid">
                  <input
                    type="checkbox"
                    className={CHECK_CLASS}
                    checked={Boolean(ticks[item.key])}
                    disabled={disabled}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => state.setTick(item.key, e.target.checked)}
                  />
                  <span>
                    {item.text}
                    {item.linkUrl && (
                      <>
                        {" "}
                        <a href={item.linkUrl} target="_blank" rel="noopener noreferrer" className="text-gold underline underline-offset-4 hover:text-gold-bright">
                          {item.linkLabel || "Read it here"}
                        </a>
                      </>
                    )}
                  </span>
                </label>
                {error && <p role="alert" className="mt-1 text-xs font-medium text-red-400">{error}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

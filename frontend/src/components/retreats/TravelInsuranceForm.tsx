import { useId } from "react";
import type { FormResponseView, TravelInsuranceData } from "@/lib/retreatsApi";
import { useRetreatForm } from "./useRetreatForm";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, Field, INPUT, LINK, PreviewNote, RadioGroup, SaveStatus } from "./retreatUi";

/**
 * Travel Insurance — guidance, a policy checklist and the guest's own status.
 *
 * The two Bali agreements disagree about insurance (Section 7 "strongly
 * recommended", Section 5 "is required"), and the owner's attorney has not yet
 * reconciled them. So this card states neither: it records an acknowledgement
 * and a status, and never gates anything on coverage.
 */

export const POLICY_CHECKLIST = [
  "Trip cancellation and interruption",
  "Emergency medical care",
  "Medical evacuation",
  "Travel delay",
  "Baggage",
  "Coverage for the retreat's activities",
  "Pre-existing condition treatment or waivers, if applicable",
  "Policy deadlines and covered reasons",
  "Exclusions and benefit limits",
];

export function validateTravelInsurance(data: TravelInsuranceData): Record<string, string> {
  const errors: Record<string, string> = {};
  if (data.acknowledged !== true) errors.acknowledged = "Please confirm you've read the travel insurance guidance.";
  if (!data.coverageStatus) errors.coverageStatus = "Choose where you are with travel insurance.";
  return errors;
}

export function TravelInsuranceGuidance() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-semibold text-white">Airfare and travel insurance are not included.</p>
      <p>
        Please review the travel insurance terms in your signed retreat agreement, and look at comprehensive travel
        insurance options before you make major nonrefundable purchases such as flights.
      </p>
      <p>
        A starting point for comparing plans:{" "}
        <a className={LINK} href="https://www.trawickinternational.com" target="_blank" rel="noopener noreferrer">
          Trawick International
        </a>{" "}
        (https://www.trawickinternational.com). It is not an exclusive provider, and no plan covers every situation —
        check the actual policy wording and purchase timing for the policy you choose.
      </p>
      <div>
        <h3 className="text-sm font-semibold text-white">Policy review checklist</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {POLICY_CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>Keep your policy details and emergency assistance contact with you while you travel.</p>
    </div>
  );
}

export function TravelInsuranceForm({
  slug,
  initial,
  readOnly,
  onSaved,
}: {
  slug: string;
  initial: FormResponseView;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const form = useRetreatForm<TravelInsuranceData>({ slug, formKey: "travel_insurance", initial, readOnly, onSaved });
  const id = useId();
  const { data, set, errors, busy } = form;
  const text = (key: "provider" | "purchaseDate" | "confirmation") => ({
    id: `${id}-${key}`,
    value: data[key] ?? "",
    disabled: readOnly,
    onChange: (event: { target: { value: string } }) => set(key, event.target.value),
    className: INPUT,
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5 border-t border-white/10 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.save(true, validateTravelInsurance);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 text-sm text-white/90">
          <input
            type="checkbox"
            className="mt-1 accent-[#C9A24B]"
            checked={data.acknowledged === true}
            disabled={readOnly}
            onChange={(event) => set("acknowledged", event.target.checked)}
            aria-invalid={errors.acknowledged ? true : undefined}
          />
          <span>
            I have read the travel insurance guidance<span className="text-gold"> *</span>
          </span>
        </label>
        {errors.acknowledged && <p role="alert" className="text-xs font-medium text-amber-200">{errors.acknowledged}</p>}
      </div>
      <RadioGroup
        legend="Coverage status"
        name={`${id}-coverage`}
        required
        disabled={readOnly}
        value={data.coverageStatus}
        onChange={(value) => set("coverageStatus", value)}
        error={errors.coverageStatus}
        options={[
          { value: "not_purchased", label: "Not purchased yet" },
          { value: "researching", label: "Researching" },
          { value: "purchased", label: "Purchased" },
          { value: "decline_or_support", label: "I'd like to decline or need support" },
        ]}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-provider`} label="Provider" error={errors.provider}>
          <input type="text" maxLength={200} {...text("provider")} />
        </Field>
        <Field id={`${id}-purchaseDate`} label="Purchase date" error={errors.purchaseDate}>
          <input type="date" {...text("purchaseDate")} />
        </Field>
      </div>
      <Field id={`${id}-confirmation`} label="Confirmation number" error={errors.confirmation}>
        <input type="text" maxLength={200} autoComplete="off" {...text("confirmation")} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_OUTLINE} disabled={readOnly || busy} onClick={() => void form.save(false)}>
          Save &amp; Finish Later
        </button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={readOnly || busy}>
          {form.response.state === "submitted" ? "Update my insurance status" : "Submit insurance status"}
        </button>
      </div>
      {readOnly ? <PreviewNote /> : <SaveStatus text={form.message.text} tone={form.message.tone} />}
    </form>
  );
}

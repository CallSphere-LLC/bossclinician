import { useId } from "react";
import type { FlightPreferencesData, FormResponseView } from "@/lib/retreatsApi";
import { useRetreatForm } from "./useRetreatForm";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, Field, INPUT, PreviewNote, RadioGroup, SaveStatus } from "./retreatUi";

/**
 * Flight Preferences — the NEW native, pre-purchase form (owner brief: departure
 * airport, travel dates, budget, connections, layovers, group travel, points or
 * miles, extension, optional considerations). No passport numbers or medical
 * detail are asked for. Distinct from the post-booking Flight Tracker.
 */

export function validateFlightPreferences(data: FlightPreferencesData): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!data.departureAirport?.trim()) errors.departureAirport = "Tell us the city or airport you'd fly from.";
  if (!data.connections) errors.connections = "Choose the kind of connections you'd prefer.";
  if (!data.groupTravel) errors.groupTravel = "Let us know if you're open to travelling with other guests.";
  if (data.outboundDate && data.returnDate && data.returnDate < data.outboundDate) {
    errors.returnDate = "The return date is before the outbound date.";
  }
  return errors;
}

export function FlightPreferencesForm({
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
  const form = useRetreatForm<FlightPreferencesData>({ slug, formKey: "flight_preferences", initial, readOnly, onSaved });
  const id = useId();
  const { data, set, errors, busy } = form;
  const text = (key: keyof FlightPreferencesData) => ({
    id: `${id}-${key}`,
    value: (data[key] as string | undefined) ?? "",
    disabled: readOnly,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined,
    onChange: (event: { target: { value: string } }) => set(key, event.target.value as never),
    className: INPUT,
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.save(true, validateFlightPreferences);
      }}
    >
      <Field id={`${id}-departureAirport`} label="Home/departure city or airport" required error={errors.departureAirport}>
        <input type="text" maxLength={200} autoComplete="off" {...text("departureAirport")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={`${id}-outboundDate`} label="Earliest outbound travel date" error={errors.outboundDate}>
          <input type="date" {...text("outboundDate")} />
        </Field>
        <Field id={`${id}-returnDate`} label="Preferred return date" error={errors.returnDate}>
          <input type="date" {...text("returnDate")} />
        </Field>
      </div>
      <Field id={`${id}-budgetRange`} label="Budget range for airfare" error={errors.budgetRange}>
        <input type="text" maxLength={200} {...text("budgetRange")} />
      </Field>
      <RadioGroup
        legend="Connections"
        name={`${id}-connections`}
        required
        disabled={readOnly}
        value={data.connections}
        onChange={(value) => set("connections", value)}
        error={errors.connections}
        options={[
          { value: "nonstop_preferred", label: "Nonstop preferred" },
          { value: "one_stop_ok", label: "One stop is fine" },
          { value: "multiple_ok", label: "Multiple connections are fine" },
          { value: "no_preference", label: "No preference" },
        ]}
      />
      <Field id={`${id}-layoverComfort`} label="Layover comfort" error={errors.layoverComfort}>
        <input type="text" maxLength={500} {...text("layoverComfort")} />
      </Field>
      <RadioGroup
        legend="Open to travelling with other guests?"
        name={`${id}-groupTravel`}
        required
        disabled={readOnly}
        value={data.groupTravel}
        onChange={(value) => set("groupTravel", value)}
        error={errors.groupTravel}
        options={[
          { value: "yes", label: "Yes" },
          { value: "maybe", label: "Maybe" },
          { value: "no", label: "No" },
        ]}
      />
      <Field id={`${id}-pointsMiles`} label="Points or miles you may use" error={errors.pointsMiles}>
        <input type="text" maxLength={500} {...text("pointsMiles")} />
      </Field>
      <RadioGroup
        legend="Trip extension"
        name={`${id}-extension`}
        disabled={readOnly}
        value={data.extension}
        onChange={(value) => set("extension", value)}
        error={errors.extension}
        options={[
          { value: "none", label: "No extension" },
          { value: "before", label: "Before the retreat" },
          { value: "after", label: "After the retreat" },
          { value: "both", label: "Both" },
          { value: "not_sure", label: "Not sure yet" },
        ]}
      />
      <Field
        id={`${id}-considerations`}
        label="Travel considerations you'd like us to know"
        hint="Please don't include passport numbers or medical details."
        error={errors.considerations}
      >
        <textarea rows={3} maxLength={2000} {...text("considerations")} />
      </Field>
      <Field id={`${id}-questions`} label="Questions for us" error={errors.questions}>
        <textarea rows={3} maxLength={2000} {...text("questions")} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_OUTLINE} disabled={readOnly || busy} onClick={() => void form.save(false)}>
          Save &amp; Finish Later
        </button>
        <button type="submit" className={BUTTON_PRIMARY} disabled={readOnly || busy}>
          {form.response.state === "submitted" ? "Update my preferences" : "Submit flight preferences"}
        </button>
      </div>
      {readOnly ? <PreviewNote /> : <SaveStatus text={form.message.text} tone={form.message.tone} />}
    </form>
  );
}

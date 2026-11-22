import { useId, useRef, useState } from "react";
import { memberRetreatsApi, type InterestChoice, type InterestView } from "@/lib/retreatsApi";
import { BUTTON_PRIMARY, errorMessage, Field, formatSavedAt, INPUT, PreviewNote, RadioGroup, SaveStatus } from "./retreatUi";

/**
 * "Where should FlourisHealer take you next?" — a voluntary preference, saved
 * to the guest's account and visible only to the organizer. Marketing email is
 * a separate, unticked opt-in: attending once is not consent to every future
 * invitation.
 */
export function InterestSelector({
  slug,
  initial,
  readOnly,
  onSaved,
}: {
  slug: string;
  initial: InterestView;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [interest, setInterest] = useState<InterestChoice | null>(initial.interest);
  const [destinations, setDestinations] = useState(initial.destinations ?? "");
  const [optIn, setOptIn] = useState(initial.marketingOptIn === true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "neutral" | "error" | "success" }>(() =>
    initial.updatedAt ? { text: `Saved ${formatSavedAt(initial.updatedAt)}`, tone: "neutral" } : { text: "", tone: "neutral" },
  );
  const inFlight = useRef(false);

  async function save() {
    if (readOnly || inFlight.current) return;
    if (!interest) {
      setMessage({ text: "Choose one of the options first.", tone: "error" });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await memberRetreatsApi.saveInterest(slug, { interest, destinations: destinations.trim(), marketingOptIn: optIn });
      setMessage({ text: `Thank you — saved ${formatSavedAt(result.current.updatedAt)}`, tone: "success" });
      onSaved?.();
    } catch (error) {
      setMessage({ text: errorMessage(error, "That didn't save. Please try again."), tone: "error" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p>Tell us which experiences you'd like to hear about. No new booking is needed to share your preference, and you can change it any time.</p>
      <RadioGroup<InterestChoice>
        legend="Which FlourisHealer experiences interest you?"
        name={`${id}-interest`}
        required
        disabled={readOnly}
        value={interest}
        onChange={setInterest}
        options={[
          { value: "international", label: "International Retreats" },
          { value: "domestic_business", label: "Domestic Business Retreats" },
          { value: "both", label: "Both" },
          { value: "not_now", label: "Not at this time" },
        ]}
      />
      <Field id={`${id}-destinations`} label="Destination preferences">
        <input id={`${id}-destinations`} type="text" maxLength={500} disabled={readOnly} value={destinations} onChange={(e) => setDestinations(e.target.value)} className={INPUT} />
      </Field>
      <label className="flex items-start gap-3 text-sm text-white/90">
        <input type="checkbox" className="mt-1 accent-[#C9A24B]" disabled={readOnly} checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
        <span>
          Yes, you may email me about future FlourisHealer retreats. <span className="text-orchid-dim">(optional)</span>
        </span>
      </label>
      <div>
        <button type="submit" className={BUTTON_PRIMARY} disabled={readOnly || busy}>
          Save my preference
        </button>
      </div>
      {readOnly ? <PreviewNote /> : <SaveStatus text={message.text} tone={message.tone} />}
    </form>
  );
}

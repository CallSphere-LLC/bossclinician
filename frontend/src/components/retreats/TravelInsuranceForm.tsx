import { LINK } from "./retreatUi";

/**
 * Travel Insurance — guidance only.
 *
 * Yvette, 22 Nov 2026: "Travel insurance is strongly recommended, not
 * required." So there is no form, no proof-of-insurance field and no checklist
 * task: the dashboard never asks for a provider, policy or confirmation number
 * and never gates anything on coverage. (The earlier status form was removed.)
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

export function TravelInsuranceGuidance() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-semibold text-white">Travel insurance is strongly recommended, but it is not required.</p>
      <p>
        Airfare and travel insurance are not included. Please look at comprehensive travel insurance options before you
        make major nonrefundable purchases such as flights.
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
        <h3 className="text-sm font-semibold text-white">If you buy a policy, things to check</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {POLICY_CHECKLIST.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>If you have a policy, keep its details and emergency assistance contact with you while you travel.</p>
    </div>
  );
}

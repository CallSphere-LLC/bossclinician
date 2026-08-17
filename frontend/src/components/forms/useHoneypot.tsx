import { useCallback, useId, useRef, useState, type ReactElement } from "react";

/** What the lead endpoint reads: an empty trap and a plausible fill time. */
export interface HoneypotPayload {
  company: string;
  elapsedMs: number;
}

/**
 * Bot trap for the public lead forms.
 *
 * Two signals, neither of which a person can trip: a field nobody sees (and so
 * nobody fills), and how long the form was on screen before it was sent. The
 * endpoint answers a failed check with the same 201 a real submission gets, so
 * a script never learns which half caught it.
 *
 * Off-screen rather than `display: none` or `hidden` — the crawlers worth
 * catching skip fields the browser reports as invisible, and fill the rest.
 *
 * Returned as a [values, element] pair, the same shape as `useConfirm` in the
 * admin kit: the caller drops the element in its form and spreads the values
 * into its payload.
 */
export function useHoneypot(): [() => HoneypotPayload, ReactElement] {
  const fieldId = useId();
  const [trap, setTrap] = useState("");
  // A ref, not state: the mount instant never changes and must not re-render
  // the form around it.
  const mountedAt = useRef(Date.now());

  const payload = useCallback(
    () => ({ company: trap, elapsedMs: Date.now() - mountedAt.current }),
    [trap],
  );

  const field = (
    // The control is named for the crawler, not for the payload key: a field
    // called "company" is one the browser's own address autofill will happily
    // fill in for a real person, which would throw their lead away. A URL-ish
    // name belongs to no autofill category, and a naive bot fills every input
    // it finds regardless.
    <div aria-hidden className="pointer-events-none absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden">
      <label htmlFor={fieldId}>Leave this field blank</label>
      <input
        id={fieldId}
        name="company_website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={trap}
        onChange={(e) => setTrap(e.target.value)}
      />
    </div>
  );

  return [payload, field];
}

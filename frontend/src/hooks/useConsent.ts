import { useEffect, useState } from "react";
import { CONSENT_EVENT, currentConsent, type ConsentState } from "@/lib/consent";

/**
 * The visitor's cookie choice, live.
 *
 * `ready` is false on the server and on the first client render, so anything
 * gated on consent renders its placeholder in both and the hydration matches;
 * the stored choice is read in an effect. Updates when the choice changes in
 * this tab (CONSENT_EVENT) or another one (`storage`).
 */
export function useConsent(): { consent: ConsentState | null; ready: boolean } {
  const [state, setState] = useState<{ consent: ConsentState | null; ready: boolean }>({
    consent: null,
    ready: false,
  });

  useEffect(() => {
    const refresh = () => setState({ consent: currentConsent(), ready: true });
    refresh();
    window.addEventListener(CONSENT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CONSENT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return state;
}

import { useEffect, type ReactNode } from "react";
import { ADMIN_ORIGIN } from "@/lib/siteOrigins";

/** Transfers only a member preview credential across the separate origins. */
export function MemberPreviewBridge({ children }: { children: ReactNode }) {
  const waiting = typeof window !== "undefined" && window.location.hash === "#admin-preview";
  useEffect(() => {
    if (!waiting || !window.opener) return;
    const adminOrigin = ADMIN_ORIGIN || window.location.origin;
    const opener = window.opener;
    const receive = (event: MessageEvent) => {
      if (event.origin !== adminOrigin || event.source !== opener || event.data?.type !== "bc-member-preview" || typeof event.data.accessToken !== "string") return;
      // MemberAuthProvider already consumes this one-time sessionStorage value.
      // An admin token is never transferred or stored here.
      sessionStorage.setItem("bc_member_impersonation", event.data.accessToken);
      window.removeEventListener("message", receive);
      history.replaceState(null, "", window.location.pathname + window.location.search);
      window.opener = null;
      window.location.reload();
    };
    window.addEventListener("message", receive);
    opener.postMessage({ type: "bc-member-preview-ready" }, adminOrigin);
    return () => window.removeEventListener("message", receive);
  }, [waiting]);
  return waiting ? <p role="status">Opening the member preview…</p> : children;
}

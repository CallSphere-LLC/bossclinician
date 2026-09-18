import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { AuthCard } from "@/components/member/AuthCard";
import { useMember } from "@/hooks/useMember";

/**
 * /logout — the address people expect to exist, and the one the old site's
 * emails and bookmarks point at. Ends the session, then lands on the sign-in
 * page. Signed out already? Same destination, no error.
 */
export default function Logout() {
  const { signOut, loading } = useMember();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    // Wait for the session check, so a refresh in flight cannot sign the
    // member straight back in after this has signed them out.
    if (loading || started.current) return;
    started.current = true;
    void signOut()
      .catch(() => undefined)
      .finally(() => navigate("/login", { replace: true }));
  }, [loading, signOut, navigate]);

  return (
    <AuthCard title="Signing you out…" documentTitle="Signing out · Boss Clinician" noindex>
      <p className="copy-luxe text-center text-sm">One moment.</p>
    </AuthCard>
  );
}

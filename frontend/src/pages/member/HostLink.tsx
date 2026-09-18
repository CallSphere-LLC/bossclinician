import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { AuthCard } from "@/components/member/AuthCard";
import { useMember } from "@/hooks/useMember";
import { safeNext } from "@/pages/member/hostLinkNext";

/**
 * Where "Join the live room as host" in the admin lands.
 *
 * The live room only lets member sessions in, and the admin lives on another
 * origin with another kind of session. So the admin mints a one-time link to
 * this page, this page trades its token for a member session as the host, and
 * the coach is walked straight through to her room. There is nothing to read
 * or press here when it works.
 */
export default function HostLink() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loading, signInAsHost } = useMember();

  // Read once: the address bar is wiped below, and a later render would
  // otherwise see an empty query string and call the link incomplete.
  const [link] = useState(() => ({
    token: searchParams.get("token"),
    next: safeNext(searchParams.get("next")),
  }));
  const [failed, setFailed] = useState(false);

  // The token works once and is good for two minutes, so it should not sit in
  // the history or be offered back by the address bar's autocomplete.
  useEffect(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);

  // Host links are single-use, so a second call would report the link as spent
  // to someone who just succeeded. StrictMode runs effects twice in
  // development, hence the ref rather than a dependency list.
  const attempted = useRef(false);

  useEffect(() => {
    // Wait for the provider's own session check. If this browser already holds
    // a member session, that refresh is in flight as the page mounts, and an
    // answer arriving after ours would put the old account back.
    if (loading || attempted.current) return;
    attempted.current = true;

    if (!link.token) {
      setFailed(true);
      return;
    }

    void signInAsHost(link.token).then(
      () => navigate(link.next, { replace: true }),
      () => setFailed(true),
    );
  }, [loading, link, signInAsHost, navigate]);

  if (failed) {
    return (
      <AuthCard
        documentTitle="Link didn't work · Boss Clinician"
        eyebrow="Hmm"
        title="That link didn't work"
        subtitle="That link has already been used or has expired. Go back to the admin and press Join again."
        noindex
      >
        <p className="text-sm leading-relaxed text-orchid-dim">
          Each link opens the room once, and only for two minutes after it is made.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      documentTitle="Opening your room · Boss Clinician"
      title="Opening your room…"
      subtitle="One moment — this usually takes a second or two."
      noindex
    >
      <div
        className="flex flex-col items-center gap-4 py-4 text-sm text-orchid-dim"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-8 animate-spin text-gold" aria-hidden />
        <span>Signing you in as the host…</span>
      </div>
    </AuthCard>
  );
}

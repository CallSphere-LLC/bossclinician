import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { BadgeCheck, Loader2, ShieldAlert, ShieldQuestionMark } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { Section } from "@/components/luxe/Section";
import { formatDate } from "@/lib/format";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

/** Mirrors `GET /api/verify/:code` in `backend/src/routes/public/verify.ts`. */
interface VerifiedCertificate {
  verificationCode: string;
  recipientName: string;
  courseTitle: string;
  completedAt: string;
  issuedAt: string;
  creditQuarterHours: number;
  creditHours: string;
  providerNumber: string;
  providerName: string;
  revokedAt: string | null;
}

type VerifyState =
  | { phase: "loading" }
  | { phase: "valid" | "revoked"; certificate: VerifiedCertificate }
  | { phase: "unknown" }
  | { phase: "error"; message: string };

/**
 * `/verify/:code` — the page printed on every certificate.
 *
 * Its reader is a licensing board or an employer with no account and no reason
 * to have one, holding a PDF and wanting to know whether it is real. So it says
 * one of three things plainly — genuine, withdrawn, or not one of ours — and
 * shows only what is printed on the face of the certificate, which is all the
 * API returns.
 *
 * A withdrawn certificate is shown as such rather than as "not found": it is
 * genuine and it is not valid, and saying only one of those would mislead
 * whoever is checking it.
 *
 * Fetched in the browser on purpose. The answer must never be cached or
 * indexed, and nothing about it is worth a crawler's time.
 */
export default function VerifyCertificate() {
  const { code = "" } = useParams();
  const [state, setState] = useState<VerifyState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/verify/${encodeURIComponent(code)}`, {
          headers: { Accept: "application/json" },
        });

        if (res.status === 404) {
          if (!cancelled) setState({ phase: "unknown" });
          return;
        }
        if (res.status === 429) {
          if (!cancelled) {
            setState({
              phase: "error",
              message: "Too many checks from this connection. Please try again in a few minutes.",
            });
          }
          return;
        }
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);

        const body = (await res.json()) as {
          status: "valid" | "revoked";
          valid: boolean;
          certificate: VerifiedCertificate;
        };
        if (!cancelled) {
          setState({ phase: body.valid ? "valid" : "revoked", certificate: body.certificate });
        }
      } catch {
        if (!cancelled) {
          setState({
            phase: "error",
            message: "We could not check that certificate just now. Please try again in a moment.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <>
      <Seo
        title="Verify a Certificate | Boss Clinician"
        description="Confirm that a Boss Clinician certificate of completion is genuine."
        noindex
      />

      <Section
        surface="deep"
        space="lg"
        aurora="violet"
        auroraIntensity={0.7}
        seam={false}
        aria-label="Certificate verification"
        containerClassName="flex min-h-[58vh] max-w-2xl flex-col justify-center"
      >
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-gold">
          Certificate verification
        </p>
        <h1 className="mt-3 text-balance font-display text-[1.9rem] font-normal leading-[1.12] text-white sm:text-[2.5rem]">
          Is this certificate genuine?
        </h1>

        <div aria-live="polite" className="mt-8">
          {state.phase === "loading" && (
            <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Checking our records…
            </p>
          )}

          {state.phase === "error" && (
            <p role="alert" className="text-sm font-medium text-red-400">
              {state.message}
            </p>
          )}

          {state.phase === "unknown" && (
            <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
              <ShieldQuestionMark aria-hidden className="size-7 text-orchid" />
              <h2 className="mt-4 font-display text-xl text-white">
                We couldn&rsquo;t find a certificate with that code
              </h2>
              <p className="copy-luxe mt-2 text-sm">
                Please check the serial number against the one printed on the certificate — it is
                easy to swap a letter for a number. If it still does not match, we have no record of
                issuing it.
              </p>
              <div className="mt-6">
                <LuxeButton to="/contact" variant="glass" size="sm">
                  Ask us about it
                </LuxeButton>
              </div>
            </GlassCard>
          )}

          {(state.phase === "valid" || state.phase === "revoked") && (
            <GlassCard
              accent={state.phase === "valid" ? "green" : "gold"}
              spotlight={false}
              interactive={false}
              className="p-6 sm:p-8"
            >
              {state.phase === "valid" ? (
                <>
                  <BadgeCheck aria-hidden className="size-7 text-green-bright" />
                  <h2 className="mt-4 flex flex-wrap items-center gap-3 font-display text-xl text-white">
                    This certificate is genuine
                    <LuxePill accent="green">Valid</LuxePill>
                  </h2>
                  <p className="copy-luxe mt-2 text-sm">
                    It was issued by Boss Clinician and the details below match our records.
                  </p>
                </>
              ) : (
                <>
                  <ShieldAlert aria-hidden className="size-7 text-gold" />
                  <h2 className="mt-4 flex flex-wrap items-center gap-3 font-display text-xl text-white">
                    This certificate has been withdrawn
                    <LuxePill accent="gold">No longer valid</LuxePill>
                  </h2>
                  <p className="copy-luxe mt-2 text-sm">
                    We did issue it, but it was withdrawn
                    {state.certificate.revokedAt
                      ? ` on ${formatDate(state.certificate.revokedAt)}`
                      : ""}{" "}
                    and should not be accepted as proof of completion or credit.
                  </p>
                </>
              )}

              <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-white/10 pt-6 sm:grid-cols-2">
                <Fact label="Awarded to" value={state.certificate.recipientName} />
                <Fact label="Course" value={state.certificate.courseTitle} />
                <Fact label="Completed" value={formatDate(state.certificate.completedAt)} />
                <Fact label="Issued" value={formatDate(state.certificate.issuedAt)} />
                {state.certificate.creditHours && (
                  <Fact label="Credit" value={state.certificate.creditHours} />
                )}
                {(state.certificate.providerName || state.certificate.providerNumber) && (
                  <Fact
                    label="CE provider"
                    value={[state.certificate.providerName, state.certificate.providerNumber]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                )}
                <Fact label="Serial number" value={state.certificate.verificationCode} mono />
              </dl>
            </GlassCard>
          )}
        </div>
      </Section>
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-orchid-faint">
        {label}
      </dt>
      <dd className={mono ? "mt-1 break-all font-mono text-sm text-white" : "mt-1 text-sm text-white"}>
        {value}
      </dd>
    </div>
  );
}

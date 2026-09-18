import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Award, Download, ExternalLink, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import { downloadCertificate, libraryApi, type MemberCertificate } from "@/lib/libraryApi";
import { formatDate } from "@/lib/format";

/**
 * The certificate for a finished course.
 *
 * Only rendered once the course is complete. The API does not say whether a
 * course carries a certificate until one has been issued, so there is no
 * "finish three more lessons to earn yours" state here — promising a document
 * this page cannot know exists is worse than saying nothing.
 *
 * Issuing normally happens on the server the moment progress reaches 100%, so
 * the usual path is: finish, land here, find it waiting. The "Get my
 * certificate" button is the door back in for the cases where it did not — a
 * course finished before its certificate was set up — and the server's own
 * sentence is shown when there is still nothing to issue.
 *
 * Claiming is a button rather than something this card does on load: it can
 * send an email, and it is rate limited, and neither belongs to a page view.
 */
export function CertificateCard({ courseId }: { courseId: number }) {
  const [certificate, setCertificate] = useState<MemberCertificate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCertificate(null);
    setLoaded(false);
    setNote("");

    void libraryApi
      .getCertificates()
      .then(({ certificates }) => {
        if (cancelled) return;
        setCertificate(certificates.find((row) => row.courseId === courseId) ?? null);
        setLoaded(true);
      })
      // A failed read is not worth an error on the course home: the card simply
      // offers the claim, which returns the existing certificate if there is one.
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const claim = async () => {
    setClaiming(true);
    setNote("");
    try {
      const result = await libraryApi.claimCertificate(courseId);
      if (result.certificate) {
        setCertificate(result.certificate);
        toast.success(result.message || "Your certificate is ready.");
      } else {
        // Our own sentence rather than the server's: its wording for "nothing
        // to issue" asks the member to finish the lessons, and this card is only
        // ever shown to somebody who already has.
        setNote(
          "There is no certificate to issue for this course just yet. Do get in touch if you were expecting one.",
        );
      }
    } catch (err) {
      const message =
        err instanceof MemberApiError
          ? err.message
          : "We could not check for your certificate just now. Please try again.";
      setNote(message);
      toast.error(message);
    } finally {
      setClaiming(false);
    }
  };

  const download = async (row: MemberCertificate) => {
    setDownloading(true);
    try {
      await downloadCertificate(row);
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not download your certificate just now. Please try again.",
      );
    } finally {
      setDownloading(false);
    }
  };

  if (!loaded) return null;

  return (
    <GlassCard accent="gold" spotlight={false} interactive={false} className="p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
        >
          <Award className="size-5 text-gold" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2.5 font-display text-xl text-white">
            Certificate
            {certificate && !certificate.revoked && <LuxePill accent="green">Earned</LuxePill>}
          </h2>

          {certificate === null && (
            <>
              <p className="copy-luxe mt-2 max-w-xl text-sm">
                You have finished the course — congratulations. If it comes with a certificate of
                completion, you can collect it here.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <LuxeButton
                  type="button"
                  size="sm"
                  disabled={claiming}
                  onClick={() => void claim()}
                >
                  {claiming && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  {claiming ? "Checking" : "Get my certificate"}
                </LuxeButton>
              </div>
            </>
          )}

          {certificate && certificate.revoked && (
            <p className="copy-luxe mt-2 max-w-xl text-sm">
              This certificate has been withdrawn
              {certificate.revokedAt ? ` on ${formatDate(certificate.revokedAt)}` : ""}, so it can no
              longer be downloaded or verified. Please get in touch if you think that is a mistake.
            </p>
          )}

          {certificate && !certificate.revoked && (
            <>
              <p className="copy-luxe mt-2 max-w-xl text-sm">
                Awarded to <span className="text-white/85">{certificate.recipientName}</span> for
                completing {certificate.courseTitle} on {formatDate(certificate.completedAt)}.
              </p>

              <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-orchid-faint">
                    Serial number
                  </dt>
                  <dd className="mt-1 break-all font-mono text-sm text-white">
                    {certificate.verificationCode}
                  </dd>
                </div>
                {certificate.creditHours && (
                  <div className="min-w-0">
                    <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-orchid-faint">
                      Credit
                    </dt>
                    <dd className="mt-1 text-sm text-white">
                      {certificate.creditHours}
                      {certificate.providerNumber && (
                        <span className="text-orchid-dim">
                          {" "}
                          · provider {certificate.providerNumber}
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <LuxeButton
                  type="button"
                  size="sm"
                  disabled={downloading}
                  onClick={() => void download(certificate)}
                >
                  {downloading ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Download aria-hidden className="size-4" />
                  )}
                  {downloading ? "Preparing" : "Download PDF"}
                </LuxeButton>
                {certificate.verifyUrl && (
                  <LuxeButton
                    href={certificate.verifyUrl}
                    target="_blank"
                    rel="noopener"
                    variant="glass"
                    size="sm"
                  >
                    <ExternalLink aria-hidden className="size-4" />
                    Verification page
                  </LuxeButton>
                )}
              </div>

              <p className="mt-4 max-w-xl text-xs leading-relaxed text-orchid-faint">
                Anyone you share the serial number with — a licensing board, an employer — can
                confirm it on the verification page without an account.
              </p>
            </>
          )}

          <p aria-live="polite" className="mt-4 min-h-[1.25rem] text-sm text-gold">
            {note}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

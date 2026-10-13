import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Award, Download, ExternalLink, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import {
  downloadCertificate,
  libraryApi,
  type CertificateStatus,
  type MemberCertificate,
} from "@/lib/libraryApi";
import { formatDate } from "@/lib/format";

/**
 * The certificate for a course.
 *
 * The server's read-only status (`/member/certificates/status/:courseId`) says
 * whether the course issues a certificate at all and, if it has not been issued
 * yet, why: lessons left, or a quiz still to pass when the course requires
 * passing every quiz ("Pass the quiz in “Final quiz” (pass mark 80%) to get your
 * certificate"). A course with no certificate renders nothing. If the status
 * cannot be read, the card falls back to its old behaviour: shown only once the
 * course is finished, offering the claim.
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
export function CertificateCard({
  courseId,
  finished = true,
}: {
  courseId: number;
  /** Every lesson done — the only time the card shows when status is unknown. */
  finished?: boolean;
}) {
  const [certificate, setCertificate] = useState<MemberCertificate | null>(null);
  const [status, setStatus] = useState<CertificateStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCertificate(null);
    setStatus(null);
    setLoaded(false);
    setNote("");

    void Promise.all([
      libraryApi
        .getCertificates()
        .then(({ certificates }) => certificates.find((row) => row.courseId === courseId) ?? null)
        // A failed read is not worth an error on the course home: the card simply
        // offers the claim, which returns the existing certificate if there is one.
        .catch(() => null),
      libraryApi.getCertificateStatus(courseId).catch(() => null),
    ]).then(([found, read]) => {
      if (cancelled) return;
      setCertificate(found);
      setStatus(read);
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [courseId, finished]);

  const claim = async () => {
    setClaiming(true);
    setNote("");
    try {
      const result = await libraryApi.claimCertificate(courseId);
      if (result.certificate) {
        setCertificate(result.certificate);
        toast.success(result.message || "Your certificate is ready.");
      } else {
        // The server's specific reason — a quiz still to pass, lessons left.
        if (result.status) setStatus(result.status);
        setNote(
          result.message ||
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
  // No certificate on this course, and none issued: nothing to promise.
  if (!certificate && status && !status.offered) return null;
  // Status unknown: the old rule — only once the course is finished.
  if (!certificate && !status && !finished) return null;

  // Something is still to do (lessons, a quiz to pass): explain, no claim button.
  // A CE watch-time shortfall keeps the button, so it can be re-checked.
  const pending = !certificate && status !== null && !status.eligible && !status.ceuPending;

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

          {certificate === null && pending && status && (
            <>
              <p className="copy-luxe mt-2 max-w-xl text-sm">
                This course comes with a certificate of completion.{" "}
                <span className="text-white/85">{status.message}</span>
              </p>
              {status.quizzesToPass.length > 1 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-orchid">
                  {status.quizzesToPass.map((quiz) => (
                    <li key={`${quiz.lessonTitle}-${quiz.assessmentTitle}`}>
                      {quiz.lessonTitle}
                      {quiz.passMark !== null && ` — pass mark ${quiz.passMark}%`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {certificate === null && !pending && (
            <>
              <p className="copy-luxe mt-2 max-w-xl text-sm">
                {status?.ceuPending
                  ? status.message
                  : status?.eligible
                    ? "You have finished the course — congratulations. Your certificate of completion is ready to collect."
                    : "You have finished the course — congratulations. If it comes with a certificate of completion, you can collect it here."}
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

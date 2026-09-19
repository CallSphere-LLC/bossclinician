import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { memberApi, MemberApiError, type MemberSessionInfo } from "@/lib/memberApi";
import { formatDateTime, formatRelative } from "@/lib/format";

type PasswordField = "currentPassword" | "newPassword";
type PasswordErrors = Partial<Record<PasswordField | "confirmPassword", string>>;

/** Pulls per-field messages out of a zod `.flatten()` payload, if there is one. */
function passwordErrorsFrom(details: unknown): PasswordErrors {
  if (typeof details !== "object" || details === null) return {};
  const flattened = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof flattened !== "object" || flattened === null) return {};

  const out: PasswordErrors = {};
  for (const key of ["currentPassword", "newPassword"] as const) {
    const messages = (flattened as Record<string, unknown>)[key];
    if (Array.isArray(messages) && typeof messages[0] === "string") out[key] = messages[0];
  }
  return out;
}

export default function Security() {
  // Bumped when the password changes, which signs every other device out and
  // makes the list below stale the instant it succeeds.
  const [sessionsToken, setSessionsToken] = useState(0);

  return (
    <MemberShell
      title="Password & devices"
      description="Change your password, and see every phone, tablet and computer currently signed in to your account."
    >
      <Seo title="Password & Devices | Boss Clinician" />
      <div className="grid gap-6">
        <ChangePasswordCard onPasswordChanged={() => setSessionsToken((n) => n + 1)} />
        <SessionsCard reloadToken={sessionsToken} />
      </div>
    </MemberShell>
  );
}

function ChangePasswordCard({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");

    // Caught here rather than at the API, which has no way to know what the
    // member typed into a second box that is never sent.
    if (next !== confirm) {
      setErrors({ confirmPassword: "These two do not match." });
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      await memberApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Your password is changed. Other devices have been signed out.");
      onPasswordChanged();
    } catch (error) {
      if (error instanceof MemberApiError) {
        setErrors(passwordErrorsFrom(error.details));
        setFormError(error.message);
      } else {
        setFormError("We could not change your password just now. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
      <h2 className="font-display text-xl text-white">Change your password</h2>
      <p className="copy-luxe mt-2 max-w-lg text-sm">
        Choosing a new password signs you out everywhere except this device.
      </p>

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="mt-6 max-w-md">
        <div className="grid gap-5">
          <LuxeInput
            label="Current password"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            value={current}
            error={errors.currentPassword}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <LuxeInput
            label="New password"
            type="password"
            name="newPassword"
            autoComplete="new-password"
            required
            value={next}
            error={errors.newPassword}
            hint="At least 10 characters. A short phrase you will remember beats a scramble you will not."
            onChange={(event) => setNext(event.target.value)}
          />
          <LuxeInput
            label="New password again"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirm}
            error={errors.confirmPassword}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>

        <div aria-live="polite" className="mt-5 min-h-[1.25rem]">
          {formError && (
            <p role="alert" className="text-sm font-medium text-red-400">
              {formError}
            </p>
          )}
        </div>

        <LuxeButton type="submit" variant="foil" size="sm" className="mt-3" disabled={saving}>
          {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {saving ? "Saving" : "Update password"}
        </LuxeButton>
      </form>
    </GlassCard>
  );
}

function SessionsCard({ reloadToken }: { reloadToken: number }) {
  const [sessions, setSessions] = useState<MemberSessionInfo[] | null>(null);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<number | null>(null);
  // Two steps rather than a browser confirm(): the question is asked in the
  // page's own voice, and it cannot be answered by a stray Enter.
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await memberApi.sessions();
        if (cancelled) return;
        setSessions(list);
        setError("");
      } catch {
        if (!cancelled) setError("We could not load your devices just now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const revoke = async (session: MemberSessionInfo) => {
    setRevoking(session.id);
    try {
      await memberApi.revokeSession(session.id);
      setSessions((list) => (list ? list.filter((row) => row.id !== session.id) : list));
      toast.success(`${describeDevice(session.userAgent)} has been signed out.`);
    } catch {
      toast.error("We could not sign that device out. Please try again.");
    } finally {
      setRevoking(null);
    }
  };

  const others = sessions?.filter((row) => !row.current).length ?? 0;

  const revokeOthers = async () => {
    setRevokingAll(true);
    try {
      await memberApi.revokeOtherSessions();
      // The server keeps the session that asked; the list keeps the same row.
      setSessions((list) => (list ? list.filter((row) => row.current) : list));
      toast.success("Done. Every other device has been signed out.");
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not sign your other devices out. Please try again.",
      );
    } finally {
      setRevokingAll(false);
      setConfirmingAll(false);
    }
  };

  return (
    <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
      <h2 className="font-display text-xl text-white">Where you are signed in</h2>
      <p className="copy-luxe mt-2 max-w-lg text-sm">
        Sessions expire 30 days after sign-in, even when you stay active. If you do not recognise a device, sign it out and change your password.
      </p>

      <div aria-live="polite" className="mt-6">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}

        {!error && sessions === null && (
          <p className="text-sm text-orchid-dim">Loading your devices…</p>
        )}

        {!error && sessions !== null && sessions.length === 0 && (
          <p className="text-sm text-orchid-dim">No other devices are signed in.</p>
        )}

        {sessions !== null && sessions.length > 0 && (
          <ul className="divide-y divide-white/[0.07]">
            {sessions.map((session) => {
              const Icon = deviceIcon(session.userAgent);
              return (
                <li
                  key={session.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="flex min-w-0 items-start gap-3.5">
                    <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-white">
                        {describeDevice(session.userAgent)}
                        {session.current && <LuxePill accent="green">This device</LuxePill>}
                      </p>
                      <p className="mt-1 text-xs text-orchid-faint">
                        Signed in {formatDateTime(session.createdAt)}
                        {session.lastUsedAt && ` · last used ${formatRelative(session.lastUsedAt)}`}
                      </p>
                    </div>
                  </div>

                  {session.current ? (
                    // Revoking the session you are reading on would bounce you
                    // to the sign-in screen mid-task; "Sign out" in the account
                    // menu is the deliberate way to do that.
                    <span className="shrink-0 text-xs text-orchid-faint sm:text-right">
                      Signed in right now
                    </span>
                  ) : (
                    <LuxeButton
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={revoking === session.id}
                      onClick={() => void revoke(session)}
                    >
                      {revoking === session.id ? "Signing out" : "Sign out this device"}
                    </LuxeButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {others > 0 && (
        <div className="mt-6 border-t border-white/[0.07] pt-6">
          {confirmingAll ? (
            <div role="group" aria-labelledby="sign-out-all-question">
              <p id="sign-out-all-question" className="text-sm font-medium text-white">
                Sign out of {others === 1 ? "your other device" : `all ${others} other devices`}?
              </p>
              <p className="copy-luxe mt-1 max-w-lg text-sm">
                You will stay signed in here. Everywhere else will need your password again.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <LuxeButton
                  type="button"
                  variant="foil"
                  size="sm"
                  disabled={revokingAll}
                  onClick={() => void revokeOthers()}
                >
                  {revokingAll && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  {revokingAll ? "Signing out" : "Yes, sign them out"}
                </LuxeButton>
                <LuxeButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revokingAll}
                  onClick={() => setConfirmingAll(false)}
                >
                  Not now
                </LuxeButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <p className="copy-luxe max-w-lg text-sm">
                Lost a phone, or used a shared computer? Sign out everywhere else in one go.
              </p>
              <LuxeButton
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-auto"
                onClick={() => setConfirmingAll(true)}
              >
                Sign out of all other devices
              </LuxeButton>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/* ── User agent → something a person can recognise ──────────────────────── */

/**
 * A raw user-agent string is unreadable and, worse, unrecognisable: nobody can
 * tell whether `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)…` is their own
 * laptop. "Chrome on macOS" is the level of detail that actually answers the
 * only question this list is asked — is that me?
 *
 * Order matters throughout. Every Chromium browser still claims to be Safari
 * and Chrome, and Edge claims to be all three, so the most specific marker has
 * to be tested first.
 */
function describeBrowser(ua: string): string | null {
  if (/Edg[A-Z]?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/FxiOS\/|Firefox\//.test(ua)) return "Firefox";
  if (/CriOS\/|Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return null;
}

function describeOs(ua: string): string | null {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function describeDevice(ua: string): string {
  const browser = describeBrowser(ua);
  const os = describeOs(ua);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unrecognised device";
}

function deviceIcon(ua: string): LucideIcon {
  // An Android tablet is an Android UA *without* the "Mobile" token — the one
  // case where the absence of a marker is the marker.
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return Tablet;
  if (/iPhone|Android|Mobile/.test(ua)) return Smartphone;
  return Monitor;
}

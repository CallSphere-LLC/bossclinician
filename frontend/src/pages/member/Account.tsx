import { useState } from "react";
import { Link } from "react-router";
import { CreditCard, MailWarning, Receipt, ShieldCheck, User, type LucideIcon } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell, MemberAvatar } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { useMember } from "@/hooks/useMember";
import { memberApi } from "@/lib/memberApi";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

interface AreaCard {
  to: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const AREAS: AreaCard[] = [
  {
    to: "/account/profile",
    icon: User,
    title: "Your details",
    body: "Your name, photo, time zone and language — what other members see and how your dates are shown.",
  },
  {
    to: "/account/security",
    icon: ShieldCheck,
    title: "Password & devices",
    body: "Change your password and see everywhere you are currently signed in.",
  },
  {
    to: "/account/billing",
    icon: CreditCard,
    title: "Billing",
    body: "Your payment method and plan.",
  },
  {
    to: "/account/purchases",
    icon: Receipt,
    title: "Purchases",
    body: "Every course, retreat and resource you have bought, with receipts.",
  },
];

export default function Account() {
  const { member } = useMember();
  if (!member) return null;

  return (
    <MemberShell
      title="Your account"
      description="Everything about you and your membership lives here."
    >
      <Seo title="Your Account | Boss Clinician" />

      {!member.emailVerifiedAt && <ConfirmEmailPrompt email={member.email} />}

      <GlassCard
        spotlight={false}
        interactive={false}
        className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8"
      >
        <MemberAvatar
          src={member.avatarUrl}
          name={member.name}
          email={member.email}
          className="size-16 text-lg sm:size-20 sm:text-xl"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl text-white">
            {member.name || "Welcome back"}
          </h2>
          <p className="mt-1 truncate text-sm text-orchid-dim">{member.email}</p>
          <p className="mt-3 text-xs uppercase tracking-[0.16em] text-orchid-faint">
            With us since {formatDate(member.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {member.emailVerifiedAt && <LuxePill accent="green">Email confirmed</LuxePill>}
          <LuxeButton to="/account/profile" variant="glass" size="sm">
            Edit details
          </LuxeButton>
        </div>
      </GlassCard>

      <ul className="mt-6 grid gap-5 sm:grid-cols-2">
        {AREAS.map((area) => (
          <li key={area.to}>
            <GlassCard accent="gold" className="h-full p-6 sm:p-7">
              <area.icon aria-hidden className="size-5 text-gold" />
              <h3 className="mt-4 font-display text-xl text-white">
                {/* Stretched link: the whole card is the tap target, but only
                    one real anchor exists for the keyboard and screen reader. */}
                <Link
                  to={area.to}
                  className={cn(
                    "after:absolute after:inset-0 after:rounded-2xl after:content-['']",
                    "focus-visible:outline-none",
                    "focus-visible:after:outline focus-visible:after:outline-2",
                    "focus-visible:after:outline-offset-2 focus-visible:after:outline-gold",
                  )}
                >
                  {area.title}
                </Link>
              </h3>
              <p className="copy-luxe mt-2 text-sm">{area.body}</p>
            </GlassCard>
          </li>
        ))}
      </ul>
    </MemberShell>
  );
}

/**
 * Unconfirmed-email prompt.
 *
 * Signed in, so the endpoint tells us what actually happened and this reports
 * it. It used to say "Sent." unconditionally — including when the transport had
 * refused the message — and because posting in the community and commenting on
 * lessons are both gated behind confirming, a member whose link never went out
 * was stuck at the gate with the screen insisting the link was on its way.
 */
function ConfirmEmailPrompt({ email }: { email: string }) {
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const resend = async () => {
    setStatus("sending");
    setFailed(false);
    try {
      const result = await memberApi.resendVerification();
      if (result.state === "failed") {
        setFailed(true);
        setMessage("We couldn't send it just now. Please try again in a few minutes.");
      } else if (result.state === "throttled") {
        setMessage("You've asked a few times already — give the last link a minute to arrive.");
      } else if (result.state === "not_needed") {
        setMessage("This address is already confirmed. Try reloading the page.");
      } else {
        setMessage("Sent. Give it a minute, and do check your spam folder.");
      }
    } catch {
      setFailed(true);
      setMessage("We couldn't send it just now. Please try again in a few minutes.");
    } finally {
      setStatus("done");
    }
  };

  return (
    <GlassCard
      accent="gold"
      spotlight={false}
      interactive={false}
      className="mb-6 flex flex-col gap-4 border-gold/25 p-6 sm:flex-row sm:items-center sm:gap-6"
    >
      <MailWarning aria-hidden className="size-6 shrink-0 text-gold" />
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg text-white">Please confirm your email address</h2>
        <p className="copy-luxe mt-1 text-sm">
          We sent a link to <span className="text-white/85">{email}</span>. Opening it keeps your
          account recoverable if you ever forget your password.
        </p>
        <p
          aria-live="polite"
          className={`mt-2 min-h-[1.25rem] text-sm ${failed ? "text-red-300" : "text-gold"}`}
        >
          {status === "done" ? message : ""}
        </p>
      </div>
      <LuxeButton
        variant="outline"
        size="sm"
        type="button"
        disabled={status === "sending"}
        onClick={() => void resend()}
        className="shrink-0"
      >
        {status === "sending" ? "Sending…" : "Send it again"}
      </LuxeButton>
    </GlassCard>
  );
}

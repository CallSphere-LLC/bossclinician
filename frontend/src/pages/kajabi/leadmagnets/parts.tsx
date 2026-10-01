import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "motion/react";
import { rise } from "@/components/home/luxe/ProgramSections";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect } from "@/components/luxe/LuxeField";
import { GoldRule } from "@/components/luxe/Section";
import { DIRECT_DOWNLOAD } from "@/content/leadMagnets";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { playableVideo } from "@/lib/videoEmbed";

/**
 * Pieces shared by the Kajabi opt-in / lead-magnet pages in this folder.
 *
 * The form posts to the site's own forms system (POST /api/forms/:slug/submit),
 * the same path the masterclass sign-up and the Boardroom application use, so a
 * sign-up is a reply in Forms, a contact, the form's tag and — through the
 * form's automation (migration 097) — the email that delivers the guide.
 */

/** The same loose check the masterclass sign-up makes before it sends. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ImageSpec {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

/* ── Icons ──────────────────────────────────────────────────────────── */

export function CheckMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("mt-[0.2rem] h-4 w-4 shrink-0 text-green-bright", className)}
    >
      <path d="M3 8.4 6.3 11.7 13 4.7" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
    </svg>
  );
}

/* ── Images ─────────────────────────────────────────────────────────── */

/** A source image in the site's glass frame. */
export function FramedImage({
  image,
  className,
  imgClassName,
  priority = false,
}: {
  image: ImageSpec;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  return (
    <GlassCard interactive={false} spotlight={false} className={cn("overflow-hidden p-2", className)}>
      <img
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={cn("h-auto w-full max-w-full rounded-xl object-cover", imgClassName)}
      />
    </GlassCard>
  );
}

/* ── Lists ──────────────────────────────────────────────────────────── */

/** Title + body cards with a tick, the shape of her "what you'll get" rows. */
export function BenefitCards({
  items,
  className,
}: {
  items: ReadonlyArray<{ readonly title: string; readonly body: string }>;
  className?: string;
}) {
  const reduce = useEntranceMotion();
  const accents: Accent[] = ["green", "plum", "gold"];
  return (
    <ul className={cn("grid list-none gap-4 sm:grid-cols-2", className)}>
      {items.map((item, i) => (
        <motion.li
          key={item.title}
          {...rise(reduce, 0.05 * i)}
          className={i === items.length - 1 && items.length % 2 === 1 ? "sm:col-span-2" : undefined}
        >
          <GlassCard
            accent={accents[i % accents.length]}
            interactive={false}
            spotlight={false}
            className="flex h-full gap-3.5 p-5 sm:p-6"
          >
            <CheckMark />
            <div className="min-w-0">
              <h3 className="text-pretty font-display text-[1.12rem] font-medium leading-snug text-white sm:text-[1.25rem]">
                {item.title}
              </h3>
              <p className="copy-luxe mt-2 text-pretty text-[0.95rem]">{item.body}</p>
            </div>
          </GlassCard>
        </motion.li>
      ))}
    </ul>
  );
}

/** "Label : body" bullets — her "WHY YOU'LL LOVE THIS GUIDE" list. */
export function LabelledList({
  items,
  className,
}: {
  items: ReadonlyArray<{ readonly label: string; readonly body: string }>;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex gap-3.5">
          <CheckMark />
          <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">
            <strong className="font-semibold text-white">{item.label}</strong> : {item.body}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── The sign-up ────────────────────────────────────────────────────── */

type Status = "idle" | "sending" | "failed" | "done";

export interface LeadMagnetFormProps {
  /** The form created by migration 097. */
  slug: string;
  submitLabel: string;
  /**
   * Where to send people once the reply is filed: her Kajabi thank-you page,
   * rebuilt at the same address. Leave out to confirm in place instead.
   */
  next?: string;
  /** The in-place confirmation, for opt-ins whose Kajabi page had none. */
  success?: { title: string; body: string; download: string };
  firstNameLabel?: string;
  emailLabel?: string;
  /** Her marketing form also asked for a last name. */
  lastNameLabel?: string;
  /** And how long they had been in practice. */
  practiceYears?: { label: string; options: readonly string[] };
  /** The consent / privacy line under the button. */
  note?: string;
  className?: string;
}

/**
 * First name and email (and on one page, two more boxes), then on to the
 * guide.
 *
 * A refusal the server explains (a bad address, the rate limit) is shown as it
 * was written. Anything else must not stand between somebody and a free guide
 * they just asked for: the message says their details did not save and offers
 * the guide anyway, beside a retry — the masterclass sign-up's rule.
 */
export function LeadMagnetForm({
  slug,
  submitLabel,
  next,
  success,
  firstNameLabel = "First Name",
  emailLabel = "Email",
  lastNameLabel,
  practiceYears,
  note,
  className,
}: LeadMagnetFormProps) {
  const navigate = useNavigate();
  const [honeypot, trapField] = useHoneypot();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [years, setYears] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;

    const name = firstName.trim();
    const address = email.trim();
    if (!name) {
      setError("Please enter your first name.");
      return;
    }
    if (lastNameLabel && !lastName.trim()) {
      setError("Please enter your last name.");
      return;
    }
    if (!EMAIL_SHAPE.test(address)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (practiceYears && !years) {
      setError(`Please answer “${practiceYears.label}”.`);
      return;
    }

    const data: Record<string, unknown> = { name, email: address };
    if (lastNameLabel) data.last_name = lastName.trim();
    if (practiceYears) data.years_in_practice = years;

    setStatus("sending");
    setError(null);
    setFallback(false);
    try {
      await api.submitForm(slug, data, address, honeypot());
      if (next) {
        navigate(next);
        return;
      }
      setStatus("done");
    } catch (err) {
      setStatus("failed");
      if (err instanceof ApiError && (err.status === 400 || err.status === 429) && err.message) {
        setError(err.message);
        return;
      }
      setError("We couldn't save your details just now. Please try again.");
      setFallback(true);
    }
  }

  if (status === "done" && success) {
    return (
      <div role="status" className={cn("text-center", className)}>
        <span
          aria-hidden
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.08] text-gold"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
          </svg>
        </span>
        <h3 className="mx-auto mt-5 max-w-[30ch] text-balance font-display text-[1.4rem] font-medium leading-tight text-white sm:text-[1.6rem]">
          {success.title}
        </h3>
        <p className="copy-luxe mx-auto mt-4 max-w-[46ch] text-pretty">{success.body}</p>
        <GoldRule className="mx-auto mt-6" width="w-12" />
        <p className="copy-luxe mx-auto mt-6 max-w-[46ch] text-pretty text-sm">{DIRECT_DOWNLOAD.note}</p>
        <LuxeButton variant="foil" size="md" href={success.download} target="_blank" className="mt-5">
          <DownloadIcon />
          {DIRECT_DOWNLOAD.label}
        </LuxeButton>
      </div>
    );
  }

  const sending = status === "sending";
  const fallbackHref = next ?? success?.download;

  return (
    <form onSubmit={handleSubmit} noValidate className={cn("relative flex flex-col gap-4", className)}>
      {trapField}
      <LuxeInput
        label={firstNameLabel}
        name="first_name"
        autoComplete="given-name"
        required
        maxLength={80}
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        disabled={sending}
      />
      {lastNameLabel && (
        <LuxeInput
          label={lastNameLabel}
          name="last_name"
          autoComplete="family-name"
          required
          maxLength={80}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          disabled={sending}
        />
      )}
      <LuxeInput
        label={emailLabel}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        maxLength={320}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={sending}
      />
      {practiceYears && (
        <LuxeSelect
          label={practiceYears.label}
          name="years_in_practice"
          required
          value={years}
          onChange={(e) => setYears(e.target.value)}
          disabled={sending}
        >
          <option value="" disabled>
            {practiceYears.label}
          </option>
          {practiceYears.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </LuxeSelect>
      )}

      {error && (
        <div role="alert" className="text-sm text-red-300">
          <p>{error}</p>
          {fallback && fallbackHref && (
            <p className="mt-2 text-orchid">
              {fallbackHref.startsWith("/downloads/") ? (
                <a
                  href={fallbackHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60"
                >
                  Download the guide anyway &rarr;
                </a>
              ) : (
                <Link
                  to={fallbackHref}
                  className="underline decoration-white/25 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60"
                >
                  Continue to your guide anyway &rarr;
                </Link>
              )}
            </p>
          )}
        </div>
      )}

      <LuxeButton
        type="submit"
        variant="foil"
        size="lg"
        disabled={sending}
        className="mt-2 w-full"
        aria-busy={sending || undefined}
      >
        {sending ? "Sending…" : (
          <>
            {submitLabel}
            <span aria-hidden>&rarr;</span>
          </>
        )}
      </LuxeButton>

      {note && <p className="text-pretty text-center text-xs leading-relaxed text-orchid-faint">{note}</p>}
    </form>
  );
}

/** The sign-up in its gold card, with an optional heading. */
export function SignupCard({
  eyebrow,
  title,
  body,
  children,
  className,
}: {
  eyebrow?: string;
  title?: ReactNode;
  body?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <GlassCard accent="gold" interactive={false} spotlight={false} className={cn("p-6 sm:p-8", className)}>
      {eyebrow && <span className="eyebrow-luxe">{eyebrow}</span>}
      {title && (
        <h2 className="text-balance font-display text-[1.5rem] font-medium leading-[1.18] text-white sm:text-[1.8rem]">
          {title}
        </h2>
      )}
      {body && <p className="copy-luxe mt-4 text-pretty text-[0.95rem]">{body}</p>}
      {(eyebrow || title || body) && <GoldRule className="mt-5" width="w-14" />}
      <div className={cn(eyebrow || title || body ? "mt-6" : undefined)}>{children}</div>
    </GlassCard>
  );
}

/* ── Delivery ───────────────────────────────────────────────────────── */

/** "Check your inbox" in her words, then the same guide as a direct link. */
export function InboxAndDownload({
  inbox,
  junk,
  download,
  className,
}: {
  inbox: string;
  junk?: string;
  download: string;
  className?: string;
}) {
  return (
    <GlassCard accent="green" interactive={false} spotlight={false} className={cn("p-6 text-center sm:p-8", className)}>
      <p className="text-balance font-display text-[1.35rem] font-medium leading-snug text-white sm:text-[1.6rem]">{inbox}</p>
      {junk && <p className="copy-luxe mt-3 text-pretty text-sm">{junk}</p>}
      <GoldRule className="mx-auto mt-6" width="w-12" />
      <p className="copy-luxe mx-auto mt-6 max-w-[44ch] text-pretty text-sm">{DIRECT_DOWNLOAD.note}</p>
      <LuxeButton variant="foil" size="md" href={download} target="_blank" className="mt-5">
        <DownloadIcon />
        {DIRECT_DOWNLOAD.label}
      </LuxeButton>
    </GlassCard>
  );
}

/* ── Video ──────────────────────────────────────────────────────────── */

/**
 * A recording, played through the same rules as the masterclass page: a file
 * this site serves plays in a `<video>`, a provider link in that provider's
 * player on a host the CSP allows. So when the recording moves into the media
 * library only the link in the content file changes.
 *
 * Resolved after mount: the frame is not part of the server render, so the
 * two renders cannot disagree about it.
 */
export function RecordingPlayer({ url, title, className }: { url: string; title: string; className?: string }) {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => setHost(window.location.host), []);
  const video = host === null ? null : playableVideo(url, host);

  return (
    <GlassCard interactive={false} spotlight={false} className={cn("overflow-hidden p-2", className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-night-deep">
        {video?.kind === "file" && (
          <video src={video.src} controls preload="metadata" playsInline className="absolute inset-0 h-full w-full" title={title} />
        )}
        {video?.kind === "frame" && (
          <iframe
            src={video.src}
            title={title}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 h-full w-full border-0"
          />
        )}
        {video?.kind === "link" && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <LuxeButton variant="foil" size="md" href={video.href} target="_blank">
              Watch the recording
            </LuxeButton>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/** One rise wrapper so pages read as a list of sections. */
export function Rise({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  const reduce = useEntranceMotion();
  return (
    <motion.div {...rise(reduce, delay)} className={className}>
      {children}
    </motion.div>
  );
}

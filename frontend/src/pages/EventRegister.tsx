import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Seo } from "@/components/Seo";
import { useHoneypot } from "@/components/forms/useHoneypot";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxeInput } from "@/components/luxe/LuxeField";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import {
  EVENT_KIND_LABEL,
  eventsApi,
  type EventRegistration,
  type PublicEvent,
} from "@/lib/eventsApi";
import NotFound from "@/pages/NotFound";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How many sessions of a series the page lists before "and N more". */
const SESSIONS_LISTED = 6;

/** Matches the server's own wording for a session, so the two never disagree. */
function formatSession(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Just the clock time — for the "or 2:15, or 2:30" alternatives. */
function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function describeLength(minutes: number): string {
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} hours`;
  if (minutes === 60) return "an hour";
  if (minutes === 90) return "an hour and a half";
  return `${minutes} minutes`;
}

/** The intro, flattened enough to sit in a meta description. */
function summarise(markdown: string): string | undefined {
  const flat = markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return undefined;
  return flat.length > 155 ? `${flat.slice(0, 152)}…` : flat;
}

/**
 * The registration a visitor is holding, kept for the length of the tab.
 *
 * The ticket is the only proof of registration a guest has, and it lives in the
 * room's query string. Without this, pulling to refresh the confirmation — the
 * most ordinary thing anyone does on a phone — throws away the seat they just
 * took and asks them to sign up a second time.
 */
interface HeldTicket {
  token: string;
  sessionLabel: string;
  icsUrl: string;
  /**
   * The reminders this event really sends, as the register call reported them.
   * Optional because a ticket recalled from a browser that stored one before
   * reminders existed will not have it; the event's own copy is the fallback.
   */
  reminderSchedule?: string[];
}

function ticketKey(slug: string): string {
  return `bossclinician.event.ticket.${slug}`;
}

function rememberTicket(slug: string, ticket: HeldTicket): void {
  try {
    window.sessionStorage.setItem(ticketKey(slug), JSON.stringify(ticket));
  } catch {
    // Private browsing and storage-full both land here. The confirmation on
    // screen still carries everything they need right now.
  }
}

function recallTicket(slug: string): HeldTicket | null {
  try {
    const raw = window.sessionStorage.getItem(ticketKey(slug));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { token, sessionLabel, icsUrl, reminderSchedule } = parsed as Partial<HeldTicket>;
    if (typeof token !== "string" || !token) return null;
    return {
      token,
      sessionLabel: typeof sessionLabel === "string" ? sessionLabel : "",
      icsUrl: typeof icsUrl === "string" ? icsUrl : "",
      reminderSchedule: Array.isArray(reminderSchedule)
        ? reminderSchedule.filter((step): step is string => typeof step === "string")
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The registration page for a webinar, a live class or a replay.
 *
 * The three kinds are one page because they sell the same thing and differ only
 * in the answer to "when is it" — a fixed date, the next session on the loop, or
 * "the moment you sign up". Splitting them into three pages is how the three
 * drift into three different promises.
 */
/**
 * The reminder promise, said only when it is true.
 *
 * This page has always claimed "I'll hold you a place and remind you before we
 * start" and, on the confirmation, "I'll send you a reminder before we begin".
 * There were no reminders configurable anywhere and no confirmation was ever
 * sent — the copy was writing cheques the platform did not honour. It now reads
 * the reminders the event really sends and names them, and says nothing at all
 * when there are none.
 */
function remindersSentence(schedule: string[] | undefined): string {
  const steps = (schedule ?? []).filter(Boolean);
  if (steps.length === 0) return "";
  if (steps.length === 1) return `I'll email you ${steps[0]}.`;
  const last = steps[steps.length - 1];
  return `I'll email you ${steps.slice(0, -1).join(", ")} and ${last}.`;
}

export default function EventRegister() {
  const { slug = "" } = useParams();
  const reduce = useReducedMotion();
  const errorId = useId();
  const [honeypot, honeypotField] = useHoneypot();

  // `undefined` while the fetch is in flight, `null` once it has 404ed.
  const [event, setEvent] = useState<PublicEvent | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<HeldTicket | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEvent(undefined);
    setLoadError(null);
    setError(null);
    setTicket(recallTicket(slug));
    eventsApi
      .get(slug)
      .then((result) => {
        if (!cancelled) setEvent(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An unpublished event 404s exactly like one that never existed, and a
        // visitor is owed neither distinction — both are simply a dead URL.
        if (err instanceof ApiError && err.status === 404) {
          setEvent(null);
          return;
        }
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : "This page couldn't be loaded just now.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!event) return;
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError("That email address doesn't look right — please check it and try again.");
      return;
    }

    setStatus("sending");
    setError(null);
    let registration: EventRegistration;
    try {
      registration = await eventsApi.register(slug, {
        email: address,
        name: name.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...honeypot(),
      });
    } catch (err: unknown) {
      if (!alive.current) return;
      setStatus("idle");
      setError(
        err instanceof Error && err.message
          ? err.message
          : `Your seat didn't save. Please try again, or email ${contactPage.email}.`,
      );
      return;
    }

    if (!alive.current) return;
    setStatus("idle");
    const held: HeldTicket = {
      token: registration.token,
      sessionLabel: registration.sessionLabel,
      icsUrl: registration.icsUrl || (registration.token ? eventsApi.icsUrl(registration.token) : ""),
      reminderSchedule: registration.reminderSchedule,
    };
    setTicket(held);
    if (held.token) rememberTicket(slug, held);
  }

  if (loadError) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Event unavailable"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <h1 className="mt-6 text-balance font-display text-[1.6rem] font-medium leading-tight text-white sm:text-[2rem]">
          This page didn't load.
        </h1>
        <p role="alert" className="copy-luxe mx-auto mt-4 max-w-[46ch] text-pretty">
          {loadError} The link is fine — try again, or email {contactPage.email} and I'll take it
          from there.
        </p>
        <LuxeButton
          variant="foil"
          size="md"
          onClick={() => setReloadKey((n) => n + 1)}
          className="mt-7 min-h-[44px]"
        >
          Try again
        </LuxeButton>
      </Section>
    );
  }

  if (event === undefined) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Loading event"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <p role="status" className="copy-luxe mt-6">
          Loading…
        </p>
      </Section>
    );
  }

  if (event === null) {
    return <NotFound />;
  }

  const upcoming = event.upcomingSessions;
  const roomPath = ticket ? `/events/${slug}/room?ticket=${encodeURIComponent(ticket.token)}` : "";

  // A repeating event's sessions still to come, and an in-person event's
  // address. Both come from the server, worked out in the event's own zone.
  const series = event.kind === "live" && event.recurrenceLabel ? event.occurrences ?? [] : [];
  const address = event.locationType === "in_person" ? (event.locationAddress ?? "").trim() : "";
  // No online link on an in-person event means no room to send anybody to.
  const offerRoom = Boolean(roomPath) && (!address || event.hasJoinLink !== false);

  const when =
    event.kind === "live" && event.startsAt ? (
      <>
        <p className="font-display text-[1.25rem] leading-snug text-white sm:text-[1.45rem]">
          {formatSession(series[0] ?? event.startsAt, event.timezone)}
        </p>
        {event.recurrenceLabel && (
          <p className="copy-luxe mt-2">
            {series.length > 0
              ? `${event.recurrenceLabel}. One sign-up saves your place at every session from here on.`
              : `${event.recurrenceLabel}. Every session in this series has now happened.`}
          </p>
        )}
        {series.length > 1 && (
          <ul aria-label="Sessions still to come" className="copy-luxe mt-3 space-y-1 text-[0.95rem]">
            {series.slice(0, SESSIONS_LISTED).map((iso) => (
              <li key={iso}>{formatSession(iso, event.timezone)}</li>
            ))}
            {series.length > SESSIONS_LISTED && (
              <li>…and {series.length - SESSIONS_LISTED} more after that.</li>
            )}
          </ul>
        )}
        <p className="copy-luxe mt-2">
          We're together for about {describeLength(event.durationMinutes)}. Doors open ten minutes
          before we start.
        </p>
      </>
    ) : event.kind === "evergreen" && upcoming.length > 0 ? (
      <>
        <p className="font-display text-[1.25rem] leading-snug text-white sm:text-[1.45rem]">
          The next session starts at {formatSession(upcoming[0], event.timezone)}
        </p>
        {upcoming.length > 1 && (
          <p className="copy-luxe mt-2">
            Can't make that one? There's another at{" "}
            {upcoming
              .slice(1, 3)
              .map((iso) => formatTime(iso, event.timezone))
              .join(", and again at ")}
            . Sign up and you'll be given the next one.
          </p>
        )}
        <p className="copy-luxe mt-2">
          It runs about {describeLength(event.durationMinutes)}, and the doors open ten minutes
          early.
        </p>
      </>
    ) : event.kind === "replay" ? (
      <>
        <p className="font-display text-[1.25rem] leading-snug text-white sm:text-[1.45rem]">
          It's ready the moment you sign up.
        </p>
        <p className="copy-luxe mt-2">
          Watch it whenever suits you — it's about {describeLength(event.durationMinutes)} long.
        </p>
      </>
    ) : (
      <>
        <p className="font-display text-[1.25rem] leading-snug text-white sm:text-[1.45rem]">
          Sign up and I'll send you the time.
        </p>
        <p className="copy-luxe mt-2">
          It runs about {describeLength(event.durationMinutes)}, and the doors open ten minutes
          early.
        </p>
      </>
    );

  return (
    <>
      <Seo
        title={`${event.title} | Boss Clinician`}
        description={summarise(event.descriptionMd)}
      />

      <LuxePageHero
        eyebrow={event.recurrenceLabel ? "A live series" : EVENT_KIND_LABEL[event.kind]}
        title={event.title}
        tone="violet"
        actions={
          // A long description would otherwise leave the form a screen and a
          // half below the fold on a phone, which is where sign-ups are lost.
          ticket ? undefined : (
            <LuxeButton variant="foil" size="md" href="#register" className="min-h-[44px]">
              {event.kind === "replay" ? "Watch it now" : "Save my seat"}
            </LuxeButton>
          )
        }
        aside={
          event.coverImage ? (
            // A fixed ratio rather than the file's own, so the column below it
            // does not jump when the artwork lands.
            <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-glass">
              <img
                src={event.coverImage}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            </div>
          ) : undefined
        }
      />

      <Section
        surface="base"
        space="md"
        aria-label={event.title}
        containerClassName="max-w-2xl"
      >
        <GlassCard accent="plum" interactive={false} spotlight={false} className="p-6 sm:p-8">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            When it happens
          </p>
          <div className="mt-3">{when}</div>

          {address && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                Where it happens
              </p>
              <p className="mt-3 whitespace-pre-line break-words text-[1.05rem] leading-snug text-white">
                {address}
              </p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-gold underline-offset-4 hover:underline"
              >
                Open in maps
              </a>
            </div>
          )}
        </GlassCard>

        {event.descriptionMd.trim() && (
          <div className="prose-boss mt-9 break-words [&_table]:block [&_table]:overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.descriptionMd}</ReactMarkdown>
          </div>
        )}

        <div id="register" className="mt-9 scroll-mt-24">
          {ticket ? (
            <GlassCard accent="green" interactive={false} spotlight={false}>
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE }}
                role="status"
                className="px-6 py-10 text-center sm:px-10 sm:py-12"
              >
                <span
                  aria-hidden
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-gold/[0.08] text-gold"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="m4.75 12.5 4.75 4.75 9.75-10.5" />
                  </svg>
                </span>

                <h2 className="mx-auto mt-6 max-w-[30ch] text-balance font-display text-[1.5rem] font-medium leading-tight text-white sm:text-[1.8rem]">
                  You're in.
                </h2>

                {/* The server formatted this for the session it actually gave
                    them, in the event's own timezone. Reformatting it here is
                    how somebody ends up at the wrong hour. */}
                {ticket.sessionLabel && (
                  <p className="mx-auto mt-4 max-w-[36ch] text-pretty text-[1rem] leading-relaxed text-white/90">
                    {ticket.sessionLabel}
                  </p>
                )}

                {address && (
                  <p className="mx-auto mt-2 max-w-[36ch] whitespace-pre-line break-words text-pretty text-[0.95rem] leading-relaxed text-white/80">
                    {address}
                  </p>
                )}

                {event.recurrenceLabel && series.length > 1 && (
                  <p className="copy-luxe mx-auto mt-2 max-w-[40ch] text-pretty">
                    Your place covers every session:{" "}
                    {event.recurrenceLabel.charAt(0).toLowerCase()}
                    {event.recurrenceLabel.slice(1)}.
                  </p>
                )}

                <p className="copy-luxe mx-auto mt-3 max-w-[40ch] text-pretty">
                  {event.kind === "replay"
                    ? "It's ready now — go straight in whenever you like."
                    : [
                        "The doors open ten minutes early, so come a few minutes ahead and settle in.",
                        // Named, not promised in the abstract: these are the
                        // reminders this event actually sends.
                        remindersSentence(ticket.reminderSchedule ?? event.reminderSchedule),
                      ]
                        .filter(Boolean)
                        .join(" ")}
                </p>

                <GoldRule className="mx-auto mt-8" />

                <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                  {offerRoom && (
                    <LuxeButton
                      variant="foil"
                      size="md"
                      to={roomPath}
                      className="min-h-[44px] w-full sm:w-auto"
                    >
                      {event.kind === "replay" ? "Start watching" : "Go to the room"}
                    </LuxeButton>
                  )}

                  {ticket.icsUrl && (
                    <a
                      href={ticket.icsUrl}
                      download
                      className={cn(
                        "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full sm:w-auto",
                        "border border-white/25 px-6 text-[0.74rem] font-semibold uppercase tracking-[0.18em] text-white/85",
                        "transition-colors duration-300 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
                      )}
                    >
                      {series.length > 1 ? "Add every session to my calendar" : "Add to calendar"}
                    </a>
                  )}
                </div>
              </motion.div>
            </GlassCard>
          ) : (
            <GlassCard accent="gold" interactive={false} className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-3">
                <LuxePill accent="gold">Free to join</LuxePill>
                <LuxePill>{EVENT_KIND_LABEL[event.kind]}</LuxePill>
              </div>

              <h2 className="mt-5 text-balance font-display text-[1.4rem] font-medium leading-tight text-white sm:text-[1.7rem]">
                {event.kind === "replay" ? "Watch it now" : "Save your seat"}
              </h2>
              <p className="copy-luxe mt-3 text-pretty">
                {event.kind === "replay"
                  ? "Add your details and I'll take you straight to it."
                  : event.reminderSchedule.length > 0
                    ? "Add your details, and I'll hold you a place and remind you before we start."
                    : "Add your details and I'll hold you a place."}
              </p>

              <form
                onSubmit={handleSubmit}
                noValidate
                aria-busy={status === "sending"}
                className="mt-7 space-y-5"
              >
                {honeypotField}

                <LuxeInput
                  label="Your first name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="min-h-[44px]"
                />

                <LuxeInput
                  label="Email address"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  aria-describedby={error ? errorId : undefined}
                  className="min-h-[44px]"
                />

                {error && (
                  <motion.p
                    id={errorId}
                    role="alert"
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className="rounded-xl border border-red-400/30 bg-red-500/[0.09] px-4 py-3 text-sm font-medium leading-relaxed text-red-300"
                  >
                    <span className="min-w-0 break-words">{error}</span>
                  </motion.p>
                )}

                <div className="pt-1">
                  <LuxeButton
                    variant="foil"
                    size="md"
                    type="submit"
                    disabled={status === "sending"}
                    className="min-h-[44px] w-full sm:w-auto"
                  >
                    {status === "sending"
                      ? "One moment…"
                      : event.kind === "replay"
                        ? "Watch it now"
                        : "Save my seat"}
                  </LuxeButton>
                </div>

                <p className="text-xs leading-relaxed text-orchid-faint">
                  I'll only use your address for this session and the odd note you can
                  unsubscribe from in one click.
                </p>
              </form>
            </GlassCard>
          )}
        </div>
      </Section>
    </>
  );
}

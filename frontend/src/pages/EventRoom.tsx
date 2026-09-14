import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { cn } from "@/lib/cn";
import { contactPage } from "@/content/site";
import {
  eventsApi,
  roomRefusal,
  type RoomAccess,
  type RoomRefusal,
} from "@/lib/eventsApi";

/** A countdown measured in days does not need a frame every second. */
const SLOW_TICK_ABOVE_MS = 60 * 60 * 1000;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "2 days" / "3 hours 10 minutes" / "45 seconds" — the wait, said out loud. */
function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return plural(seconds, "second");

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const spare = minutes % 60;
    return spare === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(spare, "minute")}`;
  }

  const days = Math.floor(hours / 24);
  const spare = hours % 24;
  return days < 2 && spare > 0 ? `${plural(days, "day")} ${plural(spare, "hour")}` : plural(days, "day");
}

/**
 * The door time and the expiry are read in the event's own zone, the same one
 * the session label is already written in. Two clocks side by side in different
 * zones is how somebody turns up three hours late.
 */
function formatInZone(iso: string, timeZone: string): string {
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

function formatDateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/** Only an http(s) address is ever put in a frame or an href. */
function isEmbeddable(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function msUntil(target: string | null): number | null {
  if (!target) return null;
  const at = new Date(target).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

/** Milliseconds left until `target`, re-rendering as it falls. */
function useCountdown(target: string | null): number | null {
  // Seeded on the first render rather than by the effect: an empty line that
  // fills a frame later is a visible jump in a row that is already laid out.
  const [remaining, setRemaining] = useState<number | null>(() => msUntil(target));

  useEffect(() => {
    const first = msUntil(target);
    setRemaining(first);
    if (first === null || first === 0) return;

    let timer: number | undefined;
    const tick = () => {
      const left = msUntil(target) ?? 0;
      setRemaining(left);
      if (left === 0) return;
      timer = window.setTimeout(tick, left > SLOW_TICK_ABOVE_MS ? 30_000 : 1000);
    };
    tick();

    return () => window.clearTimeout(timer);
  }, [target]);

  return remaining;
}

/** The frame every closed-door state shares. */
function RoomNotice({
  eyebrow,
  heading,
  children,
  actions,
}: {
  eyebrow: string;
  heading: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Section
      surface="deep"
      space="xl"
      aurora="violet"
      auroraIntensity={0.6}
      seam={false}
      aria-label={heading}
      containerClassName="flex min-h-[46vh] max-w-2xl flex-col items-center justify-center text-center"
    >
      <span className="eyebrow-luxe">{eyebrow}</span>
      <h1 className="text-balance font-display text-[1.8rem] font-medium leading-[1.15] text-white sm:text-[2.3rem]">
        {heading}
      </h1>
      <GoldRule className="mx-auto mt-7" />
      <div className="mt-6 flex flex-col items-center gap-3">{children}</div>
      {actions && <div className="mt-9 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
    </Section>
  );
}

/**
 * The room a registration opens.
 *
 * The ticket in the query string is the whole of the visitor's identity here —
 * there is no account behind it — so every one of the server's four answers gets
 * its own page: come back at five past, you're in, the replay closed on the
 * 17th, and there is no recording. A single "you can't watch this" would send
 * all four to the inbox.
 */
export default function EventRoom() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const ticket = params.get("ticket") ?? "";

  // `undefined` while the fetch is in flight, `null` once it has been refused.
  const [access, setAccess] = useState<RoomAccess | null | undefined>(undefined);
  const [refusal, setRefusal] = useState<RoomRefusal | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The door we have already re-checked once. Without it, a server clock a few
  // seconds behind the browser's would turn "check again at zero" into a poll
  // that never stops.
  const recheckedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    setAccess(undefined);
    setRefusal(null);
    setLoadError(null);
    eventsApi
      .room(slug, ticket)
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason = roomRefusal(err);
        if (reason) {
          setRefusal(reason);
          setAccess(null);
          return;
        }
        // A ticket the server does not recognise is not an outage; it is a link
        // that has been edited, expired or copied wrong, and the way out of it
        // is the registration page rather than a retry.
        setAccess(null);
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : "This room couldn't be opened just now.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [slug, ticket, reloadKey]);

  const doorsIn = useCountdown(refusal?.state === "early" ? refusal.opensAt : null);
  const closesIn = useCountdown(access?.closesAt ?? null);

  useEffect(() => {
    if (refusal?.state !== "early" || !refusal.opensAt) return;
    if (doorsIn === null || doorsIn > 0) return;
    if (recheckedFor.current === refusal.opensAt) return;
    recheckedFor.current = refusal.opensAt;
    setReloadKey((n) => n + 1);
  }, [refusal, doorsIn]);

  const backToRegistration = (
    <LuxeButton variant="foil" size="md" to={`/events/${slug}`} className="min-h-[44px]">
      Go to the sign-up page
    </LuxeButton>
  );

  if (!ticket) {
    return (
      <>
        <Seo title="Join the session | Boss Clinician" noindex />
        <RoomNotice
          eyebrow="The room"
          heading="This link is missing its ticket."
          actions={backToRegistration}
        >
          <p className="copy-luxe max-w-[46ch] text-pretty">
            Your seat comes with a personal link, and this one has lost the last part of it. Sign
            up again on the event page and you'll have a fresh one in a moment.
          </p>
        </RoomNotice>
      </>
    );
  }

  if (access === undefined) {
    return (
      <Section
        surface="deep"
        space="xl"
        aurora="violet"
        auroraIntensity={0.55}
        seam={false}
        aria-label="Opening the room"
        containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
      >
        <GoldRule className="mx-auto" />
        <p role="status" className="copy-luxe mt-6">
          Opening the room…
        </p>
      </Section>
    );
  }

  if (refusal?.state === "early") {
    return (
      <>
        <Seo title="You're a little early | Boss Clinician" noindex />
        <RoomNotice
          eyebrow="Not long now"
          heading="You're a little early."
          actions={
            <LuxeButton
              variant="foil"
              size="md"
              onClick={() => setReloadKey((n) => n + 1)}
              className="min-h-[44px]"
            >
              Check again
            </LuxeButton>
          }
        >
          {refusal.opensAt && (
            <p className="text-[1.05rem] leading-relaxed text-white/90">
              Doors open at {formatInZone(refusal.opensAt, refusal.timezone)}.
            </p>
          )}
          {/* The exact time above says the same thing, so the ticking line is
              kept out of the accessibility tree rather than announced every
              second. */}
          {doorsIn !== null && doorsIn > 0 && (
            <p aria-hidden className="copy-luxe">
              Doors open in {formatRemaining(doorsIn)}.
            </p>
          )}
          <p className="copy-luxe max-w-[46ch] text-pretty">
            Your session: {refusal.sessionLabel}. Leave this page open — it lets you in by itself
            the moment the doors open.
          </p>
        </RoomNotice>
      </>
    );
  }

  if (refusal?.state === "expired") {
    return (
      <>
        <Seo title="The replay has closed | Boss Clinician" noindex />
        <RoomNotice
          eyebrow="The replay"
          heading="This replay has closed."
          actions={backToRegistration}
        >
          <p className="copy-luxe max-w-[46ch] text-pretty">
            {refusal.closedAt
              ? `The recording was available until ${formatDateInZone(refusal.closedAt, refusal.timezone)}, and it has now come down.`
              : "The recording has come down."}{" "}
            If you still need what was covered, email {contactPage.email} and I'll point you to the
            next time it runs.
          </p>
        </RoomNotice>
      </>
    );
  }

  if (refusal?.state === "ended") {
    return (
      <>
        <Seo title="This session has finished | Boss Clinician" noindex />
        <RoomNotice eyebrow="The room" heading="This session has finished." actions={backToRegistration}>
          <p className="copy-luxe max-w-[46ch] text-pretty">
            {refusal.sessionLabel} has been and gone, and there's no recording of this one. Email{" "}
            {contactPage.email} if you'd like to know when it runs again.
          </p>
        </RoomNotice>
      </>
    );
  }

  if (access === null) {
    return (
      <>
        <Seo title="Join the session | Boss Clinician" noindex />
        <RoomNotice
          eyebrow="The room"
          heading="This link didn't open the room."
          actions={backToRegistration}
        >
          <p role="alert" className="copy-luxe max-w-[46ch] text-pretty">
            {loadError ?? "The ticket on this link isn't one I recognise."} Sign up again on the
            event page and you'll have a fresh link in a moment.
          </p>
        </RoomNotice>
      </>
    );
  }

  const replay = access.state === "replay";
  const embeddable = isEmbeddable(access.url);

  return (
    <>
      <Seo title={`${access.title} | Boss Clinician`} noindex />

      <Section
        surface="deep"
        space="sm"
        aurora="violet"
        auroraIntensity={0.5}
        seam={false}
        aria-label={access.title}
        containerClassName="max-w-5xl"
      >
        <div className="flex flex-wrap items-center gap-3">
          <LuxePill accent={replay ? "plum" : "green"}>{replay ? "Replay" : "Live now"}</LuxePill>
          <span className="text-xs text-orchid-faint">{access.sessionLabel}</span>
        </div>

        <h1 className="mt-5 text-balance font-display text-[1.8rem] font-medium leading-[1.12] text-white sm:text-[2.4rem]">
          {access.title}
        </h1>

        <div className="mt-8">
          {embeddable ? (
            <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-night-raised shadow-glass">
              <iframe
                title={access.title}
                src={access.url}
                allow="camera; microphone; autoplay; fullscreen"
                allowFullScreen
                className="size-full border-0"
              />
            </div>
          ) : (
            <GlassCard accent="gold" interactive={false} spotlight={false} className="p-6 sm:p-8">
              <p className="copy-luxe text-pretty">
                The room for this session isn't ready on this page. Email {contactPage.email} and
                I'll send you the link straight away.
              </p>
            </GlassCard>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          {/* Corporate networks and older phones block framed video outright,
              so the plain link is the path for a real share of this audience
              rather than a fallback nobody takes. */}
          {embeddable && (
            <a
              href={access.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/20 px-5",
                "text-sm text-white/85 transition-colors duration-300",
                "hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              )}
            >
              {replay ? "Open the replay in a new tab" : "Open the room in a new tab"}
            </a>
          )}

          {access.closesAt && (
            // The exact date is left to assistive tech and the ticking line to
            // the eye: announcing a countdown every second is unusable.
            <p className="text-sm text-orchid-dim">
              <span className="sr-only">
                {replay ? "This replay is available until " : "This session ends at "}
                {formatInZone(access.closesAt, access.timezone)}.
              </span>
              {closesIn !== null && closesIn > 0 && (
                <span aria-hidden>
                  {replay ? "This replay closes in " : "This session ends in "}
                  {formatRemaining(closesIn)}.
                </span>
              )}
            </p>
          )}
        </div>
      </Section>
    </>
  );
}

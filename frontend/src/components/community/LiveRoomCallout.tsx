import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Video } from "lucide-react";
import { communityApi, type LiveRoomStatus } from "@/lib/communityApi";
import { subscribeRoom, getIdleSnapshot, type RoomSnapshot } from "@/lib/liveRoom/callManager";
import { cn } from "@/lib/cn";

/**
 * The community's video call, offered at the top of every community page.
 *
 * QA row 43 (2026-09-29): a member in The Boss said she could not find web
 * calling. It was there, but only as a small "Office Hours" link at the foot of
 * the sidebar, and on a phone inside a collapsed "channels" drawer — nothing on
 * the page said "call" or "video". Skool, Circle and Kajabi all put the call
 * at the top of the community with a plain Join button, so this does too, and
 * keeps Yvette's own name for the room beside the plain words.
 *
 * It reads the room's own status endpoint (cheap: the in-process roster) once
 * on arrival and every 30 seconds after, so "2 people in the call now" is
 * roughly current without a stream per reader.
 */
export function LiveRoomCallout({
  slug,
  label,
  href,
}: {
  slug: string;
  label: string;
  href: string;
}) {
  const [room, setRoom] = useState<LiveRoomStatus | null>(null);
  const [call, setCall] = useState<RoomSnapshot>(getIdleSnapshot);

  useEffect(() => subscribeRoom(setCall), []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      communityApi
        .liveStatus(slug)
        .then((status) => {
          if (!cancelled) setRoom(status);
        })
        // The Join link still works without the status line; the room page
        // says why if it cannot be entered.
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slug]);

  const inThisCall =
    call.slug === slug &&
    (call.status === "waiting" ||
      call.status === "live" ||
      call.status === "connecting" ||
      call.status === "reconnecting");

  const { status, action, shut, busy } = liveCallCopy(room, inThisCall);

  return (
    <section
      aria-label="Community video call"
      className="flex flex-col gap-4 rounded-2xl border border-gold/30 bg-gold/[0.07] p-4 sm:flex-row sm:items-center sm:p-5"
    >
      <span
        aria-hidden
        className="relative grid size-11 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"
      >
        <Video className="size-5" />
        {busy && (
          <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-night-deep" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-gold">
          Live video call
        </p>
        <p className="mt-0.5 font-display text-lg leading-snug text-white">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-orchid-dim" aria-live="polite">
          {status}
        </p>
      </div>
      <Link
        to={href}
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          shut
            ? "border border-white/20 text-white hover:bg-white/[0.06]"
            : "bg-gold text-night-deep hover:bg-gold/90",
        )}
      >
        <Video aria-hidden className="size-4" />
        {action}
      </Link>
    </section>
  );
}

/**
 * What the card says and offers, for a room status (null while loading) and
 * whether this browser is already in this community's call. Pure, so the
 * wording is tested without a DOM.
 */
export function liveCallCopy(
  room: Pick<
    LiveRoomStatus,
    "open" | "youAreHost" | "closedReason" | "full" | "occupancy"
  > | null,
  inThisCall: boolean,
): { status: string; action: string; shut: boolean; busy: boolean } {
  const occupancy = room?.occupancy ?? 0;
  const shut = !inThisCall && room !== null && !room.open && !room.youAreHost;

  let status: string;
  if (inThisCall) status = "You're in the call now.";
  else if (room === null) status = "Video and audio with the people in this community.";
  else if (shut) status = room.closedReason || "Opens when a host joins.";
  else if (room.full) status = "The call is full right now. Try again in a few minutes.";
  else if (occupancy === 0) status = "Nobody's in yet. Start the call and others can join you.";
  else status = `${occupancy} ${occupancy === 1 ? "person is" : "people are"} in the call now.`;

  const action = inThisCall
    ? "Back to your call"
    : shut
      ? "See the room"
      : occupancy === 0
        ? "Start a call"
        : "Join the call";

  return { status, action, shut, busy: inThisCall || occupancy > 0 };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  Headphones,
  Loader2,
  Pause,
  Play,
  Rss,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { TranscriptPanel } from "@/components/player/TranscriptPanel";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import { publishingApi, type MemberPodcast, type PodcastEpisode } from "@/lib/publishingApi";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

/**
 * The shows a member can listen to, and how to get them into a podcast app.
 *
 * The private feed URL is the whole point of this page, and it is a credential:
 * it grants anybody holding it every episode of a paid show, with no sign-in.
 * So it is labelled as one in plain words, and there is a way to replace it —
 * a link that cannot be revoked is a link people are right to be afraid of.
 */
export default function Podcasts() {
  const [shows, setShows] = useState<MemberPodcast[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await publishingApi.podcasts();
        if (!cancelled) {
          setShows(list);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load your shows just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const replaceFeedUrl = useCallback((podcastId: number, feedUrl: string) => {
    setShows((list) =>
      list ? list.map((show) => (show.id === podcastId ? { ...show, feedUrl } : show)) : list,
    );
  }, []);

  return (
    <MemberShell
      title="Podcasts"
      description="Listen here, or put your own private link into whichever podcast app you already use."
    >
      <Seo title="Podcasts | Boss Clinician" />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && shows === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading your shows…
          </p>
        )}
      </div>

      {shows !== null && shows.length === 0 && <NoShows />}

      {shows !== null && shows.length > 0 && (
        <div className="grid gap-6">
          {shows.map((show) => (
            <ShowCard key={show.id} show={show} onFeedReplaced={replaceFeedUrl} />
          ))}
        </div>
      )}
    </MemberShell>
  );
}

/* ── One show ───────────────────────────────────────────────────────────── */

function ShowCard({
  show,
  onFeedReplaced,
}: {
  show: MemberPodcast;
  onFeedReplaced: (podcastId: number, feedUrl: string) => void;
}) {
  const [playing, setPlaying] = useState<number | null>(null);

  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row">
        {show.coverImage && (
          <img
            src={show.coverImage}
            alt=""
            className="size-24 shrink-0 rounded-2xl border border-white/10 object-cover sm:size-28"
          />
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-xl text-white">{show.title}</h2>
            {show.visibility === "private" ? (
              <LuxePill accent="gold">Members only</LuxePill>
            ) : (
              <LuxePill>Public</LuxePill>
            )}
          </div>
          {show.author && <p className="mt-1 text-sm text-orchid-dim">{show.author}</p>}
          {show.description && (
            <p className="copy-luxe mt-3 max-w-2xl text-sm">{show.description}</p>
          )}
          <p className="mt-3 text-xs text-orchid-faint">
            {show.episodeCount} {show.episodeCount === 1 ? "episode" : "episodes"}
            {show.latestEpisodeAt && ` · latest ${formatDate(show.latestEpisodeAt)}`}
          </p>
        </div>
      </div>

      <div aria-hidden className="rule-faint my-6 w-full" />

      <FeedBlock show={show} onFeedReplaced={onFeedReplaced} />

      {show.episodes.length > 0 && (
        <>
          <div aria-hidden className="rule-faint my-6 w-full" />
          <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
            Latest episodes
          </h3>
          <ul className="mt-3 divide-y divide-white/[0.07]">
            {show.episodes.map((episode) => (
              <li key={episode.id}>
                <EpisodeRow
                  episode={episode}
                  playing={playing === episode.id}
                  onToggle={() => setPlaying((current) => (current === episode.id ? null : episode.id))}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </GlassCard>
  );
}

/* ── The feed URL, treated as the credential it is ──────────────────────── */

function FeedBlock({
  show,
  onFeedReplaced,
}: {
  show: MemberPodcast;
  onFeedReplaced: (podcastId: number, feedUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(show.feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // No clipboard permission (or an insecure context): select it instead so
      // the member can copy it themselves rather than being told "failed".
      inputRef.current?.select();
      toast.info("Press and hold to copy the link — your browser blocked us doing it for you.");
    }
  };

  const replace = async () => {
    setReplacing(true);
    try {
      const { feedUrl } = await publishingApi.rotateFeedUrl(show.id);
      onFeedReplaced(show.id, feedUrl);
      setConfirmingReplace(false);
      toast.success("Done. The old link no longer works — add this new one to your podcast app.");
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not replace that link just now. Please try again.",
      );
    } finally {
      setReplacing(false);
    }
  };

  return (
    <div>
      <h3 className="flex items-center gap-2 font-display text-lg text-white">
        <Rss aria-hidden className="size-4 text-gold" />
        {show.personal ? "Your private listening link" : "Feed address"}
      </h3>

      {show.personal ? (
        <div className="mt-3 flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <p className="text-sm leading-relaxed text-white">
            <strong className="font-semibold">This link is yours.</strong> Anyone you send it to can
            listen to every episode, without paying and without signing in. Treat it like a
            password — and if it does get out, replace it below.
          </p>
        </div>
      ) : (
        <p className="copy-luxe mt-2 text-sm">
          This show is public, so this address is safe to pass on to anyone you like.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          ref={inputRef}
          readOnly
          value={show.feedUrl}
          aria-label={`${show.title} feed address`}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(
            "min-h-[2.75rem] w-full min-w-0 flex-1 rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3",
            "font-mono text-xs text-white/85",
            "focus-visible:border-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/70",
          )}
        />
        <LuxeButton
          type="button"
          variant={copied ? "outline" : "foil"}
          size="sm"
          className="shrink-0"
          onClick={() => void copy()}
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {copied ? "Copied" : "Copy link"}
        </LuxeButton>
      </div>
      {/* Announced separately: the button's own label change is not reliably
          read out when only its text swaps. */}
      <p aria-live="polite" className="sr-only">
        {copied ? "Link copied to your clipboard." : ""}
      </p>

      <HowToListen feedUrl={show.feedUrl} />

      {show.personal && (
        <div className="mt-5">
          {confirmingReplace ? (
            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-4">
              <p className="text-sm text-white">
                Replace this link? It will stop working everywhere you have already added it,
                including your own phone, and you will need to add the new one.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <LuxeButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={replacing}
                  onClick={() => void replace()}
                  className="border-red-400/40 text-red-200 hover:border-red-400 hover:bg-red-500/[0.12] hover:text-white"
                >
                  {replacing && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  {replacing ? "Replacing" : "Yes, replace it"}
                </LuxeButton>
                <LuxeButton
                  type="button"
                  variant="quiet"
                  onClick={() => setConfirmingReplace(false)}
                >
                  Keep the link I have
                </LuxeButton>
              </div>
            </div>
          ) : (
            <LuxeButton type="button" variant="quiet" onClick={() => setConfirmingReplace(true)}>
              Replace this link
            </LuxeButton>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The two apps this audience actually uses, in the order they use them.
 *
 * A `<details>` rather than always-open copy: the member who needs these steps
 * needs them once, and everybody else is here to copy a link.
 */
function HowToListen({ feedUrl }: { feedUrl: string }) {
  return (
    <details className="group mt-4 rounded-2xl border border-white/10 bg-white/[0.02]">
      <summary
        className={cn(
          "flex min-h-[2.75rem] cursor-pointer list-none items-center gap-2.5 px-4 py-3",
          "text-sm font-medium text-white [&::-webkit-details-marker]:hidden",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        <Headphones aria-hidden className="size-4 text-gold" />
        How to add this to a podcast app
      </summary>
      <div className="border-t border-white/[0.07] px-4 py-4">
        <h4 className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
          Apple Podcasts
        </h4>
        <ol className="copy-luxe mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Copy the link above.</li>
          <li>
            On a Mac, open Apple Podcasts and choose <em>File</em> &rarr;{" "}
            <em>Add a Show by URL</em>. On an iPhone, use the Podcasts app&apos;s{" "}
            <em>Library</em> &rarr; <em>Add a Show by URL</em>.
          </li>
          <li>Paste the link and add it. New episodes then arrive on their own.</li>
        </ol>

        <h4 className="mt-5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
          Spotify
        </h4>
        <p className="copy-luxe mt-2 text-sm">
          Spotify does not accept private links from listeners, so a members-only show cannot be
          added there. Apple Podcasts, Overcast, Pocket Casts and Castro all take the link above.
        </p>

        <h4 className="mt-5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
          Anything else
        </h4>
        <p className="copy-luxe mt-2 text-sm">
          Look for &ldquo;add by URL&rdquo; or &ldquo;add RSS feed&rdquo; and paste{" "}
          <span className="break-all font-mono text-xs text-white/80">{feedUrl}</span>.
        </p>
      </div>
    </details>
  );
}

/* ── Episodes ───────────────────────────────────────────────────────────── */

/** "42 min" / "1 hr 8 min" — nobody needs the seconds. */
function episodeLength(seconds: number): string {
  if (seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function EpisodeRow({
  episode,
  playing,
  onToggle,
}: {
  episode: PodcastEpisode;
  playing: boolean;
  onToggle: () => void;
}) {
  const length = episodeLength(episode.durationSeconds);
  // The API sends it on every episode; `lib/publishingApi` has not named the
  // field yet, and an older cached response will not carry it at all.
  const transcript = (episode as PodcastEpisode & { transcript?: string }).transcript ?? "";

  return (
    <div className="py-3.5">
      <div className="flex items-start gap-3.5">
        {episode.audioUrl && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={playing}
            aria-label={playing ? `Close the player for ${episode.title}` : `Play ${episode.title}`}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full border transition-colors duration-300",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              playing
                ? "border-gold bg-gold/[0.16] text-gold"
                : "border-white/15 bg-white/[0.04] text-white hover:border-gold/50",
            )}
          >
            {playing ? (
              <Pause aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4" />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{episode.title}</p>
          <p className="mt-1 text-xs text-orchid-faint">
            {episode.episodeNumber !== null && `Episode ${episode.episodeNumber}`}
            {episode.episodeNumber !== null && (episode.publishedAt || length) && " · "}
            {episode.publishedAt && formatDate(episode.publishedAt)}
            {episode.publishedAt && length && " · "}
            {length}
          </p>
          {episode.description && (
            <p className="copy-luxe mt-2 line-clamp-2 text-sm">{episode.description}</p>
          )}
        </div>
      </div>

      {/* Mounted only while open, so a page of episodes does not open a dozen
          audio connections on a phone. `preload="none"` covers the rest. */}
      {playing && episode.audioUrl && (
        <audio
          controls
          autoPlay
          preload="none"
          src={episode.audioUrl}
          className="mt-3 w-full"
          aria-label={`${episode.title} audio player`}
        />
      )}

      {/* Renders nothing for an episode without one. Offered whether or not the
          player is open: reading is how some members take an episode in. */}
      {transcript.trim() !== "" && (
        <div className="mt-3">
          <TranscriptPanel transcript={transcript} />
        </div>
      )}
    </div>
  );
}

/* ── Empty ──────────────────────────────────────────────────────────────── */

function NoShows() {
  return (
    <GlassCard
      spotlight={false}
      interactive={false}
      className="flex flex-col items-center px-6 py-16 text-center sm:px-8"
    >
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
      >
        <Headphones className="size-6 text-gold" />
      </span>
      <h2 className="mt-6 font-display text-2xl text-white">No shows on your account yet</h2>
      <p className="copy-luxe mt-3 max-w-md text-balance text-sm">
        Members-only podcast feeds appear here as soon as one is part of what you have bought.
      </p>
      <div className="mt-8">
        <LuxeButton to="/courses" variant="foil" size="sm">
          See what is available
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

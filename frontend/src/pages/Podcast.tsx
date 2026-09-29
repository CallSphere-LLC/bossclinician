import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Headphones, Pause, Play, Rss } from "lucide-react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { ShowNotes } from "@/components/podcast/ShowNotes";
import { usePageData } from "@/hooks/usePageData";
import {
  fetchPublicPodcast,
  type PublicPodcast,
  type PublicPodcastEpisode,
} from "@/lib/publishingApi";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import NotFound from "@/pages/NotFound";

/**
 * A public podcast, at the addresses it had on Kajabi:
 *
 *   /podcasts/<show>                      the show and every episode
 *   /podcasts/<show>/episodes/<id>        one episode: player and show notes
 *
 * `<id>` is Kajabi's episode id for an imported episode (see `pathId` in
 * routes/public/growthPublic.ts), so links to the old site's episode pages land
 * on the same episode here. Members-only shows have no public page: the API
 * answers 404 for them, and this renders the site's not-found page.
 */
export default function Podcast() {
  const { slug = "", episodeId } = useParams();
  const state = usePageData(`podcast:${slug}`, () => fetchPublicPodcast(slug));

  if (state.status === "loading") {
    return (
      <>
        <Seo title="Loading… | Boss Clinician" noindex />
        <Section
          surface="deep"
          space="xl"
          aurora="violet"
          auroraIntensity={0.55}
          seam={false}
          aria-label="Loading podcast"
          containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
        >
          <GoldRule className="mx-auto" />
          <p role="status" className="copy-luxe mt-6">
            Loading the show…
          </p>
        </Section>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <Seo title="Podcast | Boss Clinician" noindex />
        <Section
          surface="deep"
          space="xl"
          seam={false}
          aria-label="Podcast unavailable"
          containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
        >
          <p role="alert" className="copy-luxe">
            We could not load this show just now. Please try again in a moment.
          </p>
        </Section>
      </>
    );
  }

  // fetchPublicPodcast answers a 404 with null rather than throwing, so a
  // client-side load of an unknown show arrives as "ready" with nothing in it.
  if (state.status === "missing" || state.data === null) return <NotFound />;

  const show = state.data;
  if (episodeId !== undefined) {
    const episode = show.episodes.find((ep) => ep.pathId === episodeId);
    if (!episode) return <NotFound />;
    return <EpisodePage show={show} episode={episode} />;
  }
  return <ShowPage show={show} />;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function showPath(show: PublicPodcast): string {
  return `/podcasts/${show.slug}`;
}

function episodePath(show: PublicPodcast, episode: PublicPodcastEpisode): string {
  return `${showPath(show)}/episodes/${episode.pathId}`;
}

/** "9 min", "1 hr 4 min", or "" when the length is unknown. */
export function episodeLength(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "Episode 8 · May 1, 2024 · 9 min", leaving out whatever is not known. */
export function episodeMeta(episode: PublicPodcastEpisode): string {
  return [
    episode.episodeNumber !== null ? `Episode ${episode.episodeNumber}` : "",
    episode.publishedAt ? formatDate(episode.publishedAt) : "",
    episodeLength(episode.durationSeconds),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Kajabi episode titles carry their subtitle after a bar ("Cheating was my way
 * out. | How to be honest with yourself."): the second half is set as the foil
 * line under the first. `head + " | " + accent` is always the stored title.
 */
export function splitEpisodeTitle(title: string): { head: string; accent?: string } {
  const at = title.indexOf(" | ");
  if (at <= 0 || at + 3 >= title.length) return { head: title };
  return { head: title.slice(0, at), accent: title.slice(at + 3) };
}

function Artwork({ src, className }: { src: string; className?: string }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={cn("aspect-square rounded-2xl border border-white/10 object-cover", className)}
    />
  );
}

function FeedLink({ show }: { show: PublicPodcast }) {
  return (
    <a
      href={show.feedUrl}
      className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white transition-colors hover:border-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <Rss aria-hidden className="size-4 text-gold" />
      RSS feed
    </a>
  );
}

/* ── The show ───────────────────────────────────────────────────────────── */

function ShowPage({ show }: { show: PublicPodcast }) {
  const [playing, setPlaying] = useState<number | null>(null);
  const count = show.episodes.length;

  return (
    <>
      <Seo
        title={`${show.title} | Boss Clinician`}
        description={show.description.slice(0, 300)}
        image={show.coverImage || undefined}
        canonicalPath={showPath(show)}
      />

      <LuxePageHero
        eyebrow="Podcast"
        title={show.title}
        lede={show.description}
        tone="violet"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {show.author && <span className="text-sm text-orchid-dim">with {show.author}</span>}
            <span className="text-sm text-orchid-faint">
              {count} {count === 1 ? "episode" : "episodes"}
            </span>
            <FeedLink show={show} />
          </div>
        }
        aside={
          show.coverImage ? (
            <Artwork src={show.coverImage} className="mx-auto w-full max-w-sm" />
          ) : undefined
        }
      />

      <Section surface="base" space="md" aria-label="All episodes">
        <div className="mx-auto grid max-w-4xl gap-4">
          {count === 0 && (
            <p className="copy-luxe text-center">The first episode is on its way.</p>
          )}
          {show.episodes.map((episode) => (
            <EpisodeCard
              key={episode.id}
              show={show}
              episode={episode}
              playing={playing === episode.id}
              onToggle={() => setPlaying((id) => (id === episode.id ? null : episode.id))}
            />
          ))}
        </div>
      </Section>
    </>
  );
}

function EpisodeCard({
  show,
  episode,
  playing,
  onToggle,
}: {
  show: PublicPodcast;
  episode: PublicPodcastEpisode;
  playing: boolean;
  onToggle: () => void;
}) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-4 sm:p-6">
      <div className="flex items-start gap-4">
        <Artwork src={episode.coverImage} className="hidden size-20 shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-snug text-white sm:text-xl">
            <Link
              to={episodePath(show, episode)}
              className="hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {episode.title}
            </Link>
          </h2>
          <p className="mt-1 text-xs text-orchid-faint">{episodeMeta(episode)}</p>
          {episode.description && (
            <p className="copy-luxe mt-2 line-clamp-3 text-sm">{episode.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {episode.audioUrl && (
              <button
                type="button"
                onClick={onToggle}
                aria-pressed={playing}
                aria-label={playing ? `Close the player for ${episode.title}` : `Play ${episode.title}`}
                className={cn(
                  "inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border px-4 text-sm transition-colors duration-300",
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
                {playing ? "Close player" : "Play"}
              </button>
            )}
            <Link
              to={episodePath(show, episode)}
              className="text-sm text-orchid-dim underline-offset-4 hover:text-gold hover:underline"
            >
              Show notes
            </Link>
          </div>
        </div>
      </div>

      {/* Mounted only while open, so a page of episodes does not open nine
          audio connections on a phone. */}
      {playing && episode.audioUrl && (
        <audio
          controls
          autoPlay
          preload="none"
          src={episode.audioUrl}
          className="mt-4 w-full"
          aria-label={`${episode.title} audio player`}
        />
      )}
    </GlassCard>
  );
}

/* ── One episode ────────────────────────────────────────────────────────── */

function EpisodePage({ show, episode }: { show: PublicPodcast; episode: PublicPodcastEpisode }) {
  const { head, accent } = splitEpisodeTitle(episode.title);

  return (
    <>
      <Seo
        title={`${episode.title} | ${show.title}`}
        description={episode.description.slice(0, 300)}
        image={episode.coverImage || show.coverImage || undefined}
        type="article"
        author={show.author || undefined}
        publishedTime={episode.publishedAt ?? undefined}
        canonicalPath={episodePath(show, episode)}
      />

      <LuxePageHero
        eyebrow={show.title}
        title={head}
        titleAccent={accent}
        lede={episodeMeta(episode)}
        tone="violet"
        aside={
          episode.coverImage ? (
            <Artwork src={episode.coverImage} className="mx-auto w-full max-w-xs" />
          ) : undefined
        }
      />

      <Section surface="base" space="md" aurora={false} aria-label="Episode">
        <div className="mx-auto max-w-[68ch]">
          {episode.audioUrl ? (
            <audio
              controls
              preload="metadata"
              src={episode.audioUrl}
              className="w-full"
              aria-label={`${episode.title} audio player`}
            />
          ) : (
            <p className="flex items-center gap-2 text-sm text-orchid-dim">
              <Headphones aria-hidden className="size-4" />
              The audio for this episode is not available yet.
            </p>
          )}

          <ShowNotes
            className="mt-8"
            markdown={episode.showNotesMd || episode.description}
          />

          <div aria-hidden className="rule-faint mt-10 w-full" />

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to={showPath(show)}
              className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white transition-colors hover:border-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <ArrowLeft aria-hidden className="size-4" />
              All episodes
            </Link>
            <FeedLink show={show} />
          </div>
        </div>
      </Section>
    </>
  );
}

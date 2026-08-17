import { useEffect, useRef } from "react";
import { AudioLines } from "lucide-react";
import type { ProgressResult } from "@/lib/libraryApi";
import { SpeedControl, useStoredPlaybackRate } from "@/components/player/SpeedControl";
import { useMediaKeys } from "@/components/player/useMediaKeys";
import { useMediaProgress } from "@/components/player/useMediaProgress";
import { useRenewableSource } from "@/components/player/useRenewableSource";

interface AudioPlayerProps {
  lessonId: number;
  src: string;
  captionsUrl: string;
  title: string;
  moduleTitle: string;
  artwork: string;
  startAt: number;
  initialPercent: number;
  onSaved: (result: ProgressResult) => void;
}

/**
 * The audio lesson.
 *
 * Given a plate rather than left as a bare control bar floating on the page: an
 * audio lesson is often the only thing on screen, and a 54px strip with nothing
 * around it reads as a broken video. Same resume, same speed control and same
 * shortcuts as video — the two differ in what they look like, not in how they
 * behave.
 */
export function AudioPlayer({
  lessonId,
  src,
  captionsUrl,
  title,
  moduleTitle,
  artwork,
  startAt,
  initialPercent,
  onSaved,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useStoredPlaybackRate();

  useMediaProgress({ media: audioRef, lessonId, startAt, initialPercent, onSaved });
  useMediaKeys(audioRef, true);
  // As in VideoPlayer: a renewed signed URL must not restart the lesson.
  useRenewableSource(audioRef, src);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, [rate, src]);

  if (!src) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-orchid-dim">
        This lesson&rsquo;s audio is not available yet. Please check back shortly.
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-glass sm:p-5">
      <div className="flex items-center gap-4">
        {artwork ? (
          <img
            src={artwork}
            alt=""
            className="size-16 shrink-0 rounded-xl object-cover sm:size-20"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/[0.08] sm:size-20"
          >
            <AudioLines className="size-7 text-gold" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-display text-lg text-white">{title}</p>
          <p className="truncate text-xs uppercase tracking-[0.14em] text-orchid-faint">
            {moduleTitle}
          </p>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        controls
        preload="metadata"
        className="mt-4 w-full"
        aria-label={title}
      >
        {captionsUrl && (
          <track kind="captions" src={captionsUrl} srcLang="en" label="English" default />
        )}
      </audio>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SpeedControl rate={rate} onChange={setRate} />
      </div>
    </div>
  );
}

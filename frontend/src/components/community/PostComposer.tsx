import { useState } from "react";
import {
  BarChart3,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  Type,
  X,
} from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { MemberAvatar } from "@/components/member/MemberShell";
import { communityApi, safeLink, type NewPostInput, type PostKind } from "@/lib/communityApi";
import { MemberApiError } from "@/lib/memberApi";
import { cn } from "@/lib/cn";

/**
 * The box at the top of a channel.
 *
 * It gathers the post and hands it upward; the feed owns the optimistic insert,
 * because the feed owns the list the post has to appear in and the rollback if
 * it never arrives.
 *
 * The draft is only cleared once the caller reports a save. Wiping the fields
 * on submit and hoping is how somebody loses four paragraphs to a dropped
 * connection, and that is the single most expensive bug a composer can have.
 */

const KINDS: { kind: PostKind; label: string; icon: typeof Type }[] = [
  { kind: "text", label: "Write", icon: Type },
  { kind: "image", label: "Image", icon: ImageIcon },
  { kind: "video", label: "Video", icon: Film },
  { kind: "poll", label: "Poll", icon: BarChart3 },
  { kind: "file", label: "File", icon: Paperclip },
  { kind: "link", label: "Link", icon: Link2 },
];

const MEDIA_PLACEHOLDER: Partial<Record<PostKind, string>> = {
  image: "https://…/photo.jpg",
  video: "https://…/clip.mp4",
  file: "https://…/worksheet.pdf",
  link: "https://…",
};

const MAX_POLL_OPTIONS = 6;

interface PostComposerProps {
  /** Needed for the upload endpoint, which is scoped to the community. */
  communitySlug: string;
  channelName: string;
  authorName: string;
  authorEmail: string;
  authorAvatarUrl: string;
  /** Resolves true when the post was accepted, which is what clears the draft. */
  onSubmit: (input: NewPostInput) => Promise<boolean>;
}

export function PostComposer({
  communitySlug,
  channelName,
  authorName,
  authorEmail,
  authorAvatarUrl,
  onSubmit,
}: PostComposerProps) {
  const [kind, setKind] = useState<PostKind>("text");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  /** The name of what was uploaded, so the composer can show it. */
  const [mediaLabel, setMediaLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const needsMedia =
    kind === "image" || kind === "video" || kind === "link" || kind === "file";
  /** Image and file can be uploaded here; video and link stay a URL. */
  const canUpload = kind === "image" || kind === "file";
  const filledOptions = options.map((o) => o.trim()).filter(Boolean);

  const reset = () => {
    setTitle("");
    setBody("");
    setMediaUrl("");
    setMediaLabel("");
    setOptions(["", ""]);
    setError("");
    setKind("text");
    setOpen(false);
  };

  /** The same rules the endpoint applies, said before the round trip. */
  const validate = (): string => {
    if (needsMedia) {
      if (!mediaUrl.trim()) {
        return canUpload ? "Choose a file, or paste a link." : "Paste a link first.";
      }
      if (!safeLink(mediaUrl.trim())) {
        return "That link needs to start with http:// or https://";
      }
      return "";
    }
    if (!body.trim()) return "Write something first.";
    if (kind === "poll" && filledOptions.length < 2) {
      return "A poll needs at least two options.";
    }
    return "";
  };

  const submit = async () => {
    const problem = validate();
    setError(problem);
    if (problem || sending) return;

    setSending(true);
    const ok = await onSubmit({
      kind,
      title: title.trim(),
      body: body.trim(),
      ...(needsMedia ? { mediaUrl: mediaUrl.trim() } : {}),
      ...(mediaLabel ? { mediaLabel } : {}),
      ...(kind === "poll" ? { pollOptions: filledOptions } : {}),
    });
    setSending(false);
    if (ok) reset();
  };

  return (
    <GlassCard as="section" spotlight={false} interactive={false} className="p-4 sm:p-5">
      <h2 className="sr-only">Write a post in {channelName}</h2>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex w-full min-h-[2.75rem] items-center gap-3 rounded-xl border border-white/12",
            "bg-white/[0.03] px-4 py-3 text-left transition-colors duration-300",
            "hover:border-gold/40 hover:bg-white/[0.06]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          <MemberAvatar src={authorAvatarUrl} name={authorName} email={authorEmail} />
          <span className="text-sm text-white/45">Share something with {channelName}…</span>
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex items-center gap-3">
            <MemberAvatar src={authorAvatarUrl} name={authorName} email={authorEmail} />
            <p className="text-sm font-semibold text-white">{authorName || "You"}</p>
          </div>

          {/* A group of toggles, not a tablist: there are no tabpanels here,
              and `role="tab"` without them tells a screen reader to expect a
              structure that does not exist. */}
          <div role="group" aria-label="What kind of post" className="flex flex-wrap gap-1.5">
            {KINDS.map((item) => (
              <button
                key={item.kind}
                type="button"
                aria-pressed={kind === item.kind}
                onClick={() => {
                  setKind(item.kind);
                  setError("");
                }}
                className={cn(
                  "inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border px-4",
                  "text-[0.68rem] font-semibold uppercase tracking-[0.14em] transition-colors duration-300",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  kind === item.kind
                    ? "border-gold/50 bg-gold/[0.12] text-gold"
                    : "border-white/12 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white",
                )}
              >
                <item.icon aria-hidden className="size-4" />
                {item.label}
              </button>
            ))}
          </div>

          <label className="sr-only" htmlFor="composer-title">
            Title (optional)
          </label>
          <input
            id="composer-title"
            value={title}
            maxLength={300}
            placeholder="Add a title (optional)"
            onChange={(e) => setTitle(e.target.value)}
            className={luxeControlClass}
          />

          <label className="sr-only" htmlFor="composer-body">
            {kind === "poll" ? "Your question" : "Your post"}
          </label>
          <textarea
            id="composer-body"
            rows={kind === "poll" ? 3 : 5}
            value={body}
            maxLength={20_000}
            placeholder={
              kind === "poll"
                ? "What do you want to ask the room?"
                : needsMedia
                  ? "Say something about it (optional)"
                  : "What's on your mind?"
            }
            onChange={(e) => setBody(e.target.value)}
            className={cn(luxeControlClass, "resize-y leading-relaxed")}
          />

          {needsMedia && (
            <>
              {canUpload && (
                <div className="flex flex-wrap items-center gap-3">
                  {/* A real upload, not just a URL box. The composer could only
                      take a link before, which meant a member could post a
                      picture only if they already hosted it somewhere. */}
                  <label
                    className={cn(
                      "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full",
                      "border border-white/15 px-4 text-sm font-semibold text-white/80",
                      "transition-colors hover:border-gold/40 hover:text-gold",
                    )}
                  >
                    <Paperclip aria-hidden className="size-4" />
                    {uploading ? "Uploading…" : "Choose a file"}
                    <input
                      type="file"
                      className="sr-only"
                      accept={kind === "image" ? "image/*" : "image/*,application/pdf"}
                      disabled={uploading}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setUploading(true);
                        setError("");
                        try {
                          const saved = await communityApi.uploadAttachment(communitySlug, file);
                          setMediaUrl(saved.url);
                          setMediaLabel(saved.label);
                        } catch (err) {
                          setError(
                            err instanceof MemberApiError
                              ? err.message
                              : "That file didn't upload. Try a smaller one.",
                          );
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                  {mediaLabel && (
                    <span className="min-w-0 truncate text-xs text-white/60">{mediaLabel}</span>
                  )}
                  <span className="text-xs text-white/35">
                    or paste a link below · up to 8MB
                  </span>
                </div>
              )}
              <label className="sr-only" htmlFor="composer-media">
                Link
              </label>
              <input
                id="composer-media"
                type="url"
                inputMode="url"
                value={mediaUrl}
                maxLength={2000}
                placeholder={MEDIA_PLACEHOLDER[kind]}
                onChange={(e) => {
                  setMediaUrl(e.target.value);
                  // A pasted link is not the uploaded file any more.
                  setMediaLabel("");
                }}
                className={luxeControlClass}
              />
            </>
          )}

          {kind === "poll" && (
            <PollOptionFields options={options} onChange={setOptions} />
          )}

          <div aria-live="polite">
            {error && (
              <p role="alert" className="text-sm font-medium text-red-400">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2.5">
            <LuxeButton type="submit" size="sm" disabled={sending}>
              {sending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Posting…
                </>
              ) : (
                "Post"
              )}
            </LuxeButton>
            <LuxeButton type="button" variant="glass" size="sm" onClick={reset} disabled={sending}>
              Cancel
            </LuxeButton>
          </div>
        </form>
      )}
    </GlassCard>
  );
}

function PollOptionFields({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
        Options
      </legend>

      {options.map((option, index) => (
        // Index as key is right here and only here: these are positional slots
        // in a short ordered list, not identified rows, and removing the third
        // is meant to shuffle the fourth up into its place.
        <div key={index} className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`poll-option-${index}`}>
            Option {index + 1}
          </label>
          <input
            id={`poll-option-${index}`}
            value={option}
            maxLength={200}
            placeholder={`Option ${index + 1}`}
            onChange={(e) =>
              onChange(options.map((value, i) => (i === index ? e.target.value : value)))
            }
            className={luxeControlClass}
          />
          {options.length > 2 && (
            <button
              type="button"
              onClick={() => onChange(options.filter((_, i) => i !== index))}
              aria-label={`Remove option ${index + 1}`}
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-xl text-orchid-dim",
                "transition-colors duration-300 hover:bg-white/[0.07] hover:text-red-400",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              )}
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      ))}

      {options.length < MAX_POLL_OPTIONS && (
        <LuxeButton
          type="button"
          variant="quiet"
          onClick={() => onChange([...options, ""])}
          className="self-start"
        >
          <Plus aria-hidden className="size-4" />
          Add an option
        </LuxeButton>
      )}
    </fieldset>
  );
}

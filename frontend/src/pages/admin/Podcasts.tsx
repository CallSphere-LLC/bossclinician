import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Check,
  Copy,
  Headphones,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mic,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { FeedToken, MediaAsset, Member, Podcast, PodcastEpisode } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatBytes, formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import { friendlyError, pluralize, publishLabel, slugify, uniqueKey } from "@/pages/admin/ui/friendly";

const EMPTY_SHOW = {
  title: "",
  description: "",
  author: "Yvette Howard, LCSW",
  category: "Business",
  visibility: "public",
  explicit: false,
  published: true,
};

/**
 * The categories listening apps actually accept. It used to be a free-text box
 * labelled "iTunes category", where a typo quietly stopped the show being filed
 * anywhere — a dropdown makes a wrong answer impossible.
 */
const CATEGORIES = [
  "Arts",
  "Business",
  "Comedy",
  "Education",
  "Fiction",
  "Government",
  "Health & Fitness",
  "History",
  "Kids & Family",
  "Leisure",
  "Music",
  "News",
  "Religion & Spirituality",
  "Science",
  "Society & Culture",
  "Sports",
  "Technology",
  "True Crime",
  "TV & Film",
];

/** Stored visibility → who she'd say can hear the show. */
const VISIBILITY_LABEL: Record<string, string> = {
  public: "Anyone can listen",
  private: "Members only",
};

/* --------------------------------------------------- Writing box + toolbar */

type FormatId = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";

/** Formats that wrap whatever is selected. */
const WRAPPERS: Record<"bold" | "italic", { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold words" },
  italic: { marker: "_", placeholder: "italic words" },
};

/** Formats that act on whole lines; a numbered list needs the line's position. */
const LINE_RULES: Record<
  "heading" | "bullets" | "numbers",
  { match: RegExp; prefix: (index: number) => string }
> = {
  heading: { match: /^#{1,6}\s+/, prefix: () => "## " },
  bullets: { match: /^[-*]\s+/, prefix: () => "- " },
  numbers: { match: /^\d+\.\s+/, prefix: (index) => `${index + 1}. ` },
};

interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Writes the formatting into the stored text and says where the cursor should
 * land afterwards. The text is still Markdown on the way to the database —
 * that's what the feed and the emails render — but she never types a hash or an
 * asterisk herself.
 *
 * Same rules as the blog editor's toolbar, deliberately: the writing boxes
 * across the dashboard should behave identically. It lives per screen only
 * because the shared UI kit doesn't carry a writing box yet.
 */
function applyFormat(id: FormatId, value: string, start: number, end: number): TextEdit {
  if (id === "bold" || id === "italic") {
    const { marker, placeholder } = WRAPPERS[id];
    // With nothing selected we drop in an example and select it, so her next
    // keystroke replaces it instead of leaving stray marks behind.
    const selected = value.slice(start, end) || placeholder;
    const inserted = `${marker}${selected}${marker}`;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  }

  if (id === "link") {
    const text = value.slice(start, end) || "the words people click";
    const href = "https://";
    const inserted = `[${text}](${href})`;
    // Leave the address half selected: pasting the link is the very next thing
    // she'll want to do.
    const hrefStart = start + text.length + "[](".length;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: hrefStart,
      selectionEnd: hrefStart + href.length,
    };
  }

  // The rest change whole lines, so grow the range to cover every line the
  // selection touches before rewriting them.
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;

  const rule = LINE_RULES[id];
  const lines = value.slice(lineStart, lineEnd).split("\n");
  // Pressing the same button again takes the formatting off, the way the list
  // button in a word processor does.
  const alreadyApplied = lines.every((line) => rule.match.test(line));
  const rewritten = lines
    .map((line, index) => {
      const bare = line.replace(rule.match, "");
      return alreadyApplied ? bare : rule.prefix(index) + bare;
    })
    .join("\n");

  return {
    value: value.slice(0, lineStart) + rewritten + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + rewritten.length,
  };
}

const TOOLBAR: { id: FormatId; label: string; Icon: LucideIcon }[] = [
  { id: "bold", label: "Bold", Icon: Bold },
  { id: "italic", label: "Italic", Icon: Italic },
  { id: "heading", label: "Heading", Icon: Heading2 },
  { id: "bullets", label: "Bulleted list", Icon: List },
  { id: "numbers", label: "Numbered list", Icon: ListOrdered },
  { id: "link", label: "Add a link", Icon: Link2 },
];

function BodyEditor({
  value,
  onChange,
  rows = 8,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);

  // A controlled textarea puts the caret back at the end after every re-render,
  // which would throw her cursor to the bottom each time she used the toolbar.
  useLayoutEffect(() => {
    const range = pendingSelection.current;
    const el = ref.current;
    if (!range || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  });

  function runFormat(id: FormatId) {
    const el = ref.current;
    if (!el) return;
    const edit = applyFormat(id, el.value, el.selectionStart, el.selectionEnd);
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.value);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
        {!preview &&
          TOOLBAR.map(({ id, label, Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="iconSm"
              title={label}
              aria-label={label}
              onClick={() => runFormat(id)}
            >
              <Icon />
            </Button>
          ))}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant={preview ? "ghost" : "secondary"}
            size="sm"
            onClick={() => setPreview(false)}
          >
            Write
          </Button>
          <Button
            type="button"
            variant={preview ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPreview(true)}
          >
            See how it looks
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="prose-boss min-h-[10rem] rounded-xl border border-hairline bg-white/[0.03] p-4">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="text-sm text-ink-soft">
              Nothing written yet — switch to Write and start typing.
            </p>
          )}
        </div>
      ) : (
        <Textarea
          ref={ref}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Screen */

export default function Podcasts() {
  const [shows, setShows] = useState<Podcast[] | null>(null);
  const [active, setActive] = useState<Podcast | null>(null);
  const [episodes, setEpisodes] = useState<PodcastEpisode[] | null>(null);
  const [links, setLinks] = useState<FeedToken[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState<Partial<Podcast> | null>(null);
  const [episodeDraft, setEpisodeDraft] = useState<Partial<PodcastEpisode> | null>(null);
  // Which box the file picker is filling in — the episode's audio or the
  // show's cover art. The kind is held separately so the picker doesn't flip
  // from pictures to audio while it's animating closed.
  const [picking, setPicking] = useState<"audio" | "cover" | null>(null);
  const [pickerKind, setPickerKind] = useState<"audio" | "image">("audio");
  const [copied, setCopied] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  function openPicker(target: "audio" | "cover") {
    setPickerKind(target === "cover" ? "image" : "audio");
    setPicking(target);
  }

  const loadShows = useCallback(() => {
    adminApi
      .growthList<Podcast>("podcasts")
      .then((list) => {
        setShows(list);
        // Re-read by id so the panel shows what was just saved — keeping the
        // old object left "Members only" looking like it had not applied.
        setActive((prev) => (prev ? (list.find((s) => s.id === prev.id) ?? list[0]) : list[0]) ?? null);
      })
      .catch(() => setError("We couldn't load your shows. Try refreshing the page."));
  }, []);

  useEffect(loadShows, [loadShows]);
  useEffect(() => {
    adminApi.membersList().then(setMembers).catch(() => undefined);
  }, []);

  const loadDetail = useCallback((podcastId: number) => {
    setEpisodes(null);
    adminApi.podcastEpisodes(podcastId).then(setEpisodes).catch(() => setEpisodes([]));
    adminApi.feedTokens(podcastId).then(setLinks).catch(() => setLinks([]));
  }, []);

  useEffect(() => {
    if (active) loadDetail(active.id);
  }, [active, loadDetail]);

  const listeningLink = active
    ? `${window.location.origin}/api/podcast/${active.slug}/rss.xml`
    : "";
  /** The same link, personalised so one listener can be cut off on their own. */
  const privateLink = (token: string) => `${listeningLink}?token=${token}`;

  async function saveShow(e: FormEvent) {
    e.preventDefault();
    if (!showDraft?.title?.trim()) return;
    // The web address is derived from the title and never shown; an existing
    // show keeps the one it already has so links people saved keep working.
    const takenAddresses = (shows ?? [])
      .filter((s) => s.id !== showDraft.id)
      .map((s) => s.slug);
    const payload = {
      ...showDraft,
      // `|| "show"` covers a name that leaves nothing behind once it's cleaned
      // up — an emoji, say — which would otherwise give the show a blank
      // address and collide with the next one.
      slug: showDraft.slug || uniqueKey(slugify(showDraft.title) || "show", takenAddresses, "-"),
    };
    try {
      if (showDraft.id) await adminApi.growthUpdate("podcasts", showDraft.id, payload);
      else await adminApi.growthCreate("podcasts", payload);
      toast.success(showDraft.id ? "Show saved" : "Show created");
      setShowDraft(null);
      loadShows();
    } catch (err) {
      toast.error(friendlyError(err, "show"));
    }
  }

  async function saveEpisode(e: FormEvent) {
    e.preventDefault();
    if (!episodeDraft?.title?.trim() || !active) return;
    const payload = {
      ...episodeDraft,
      podcastId: active.id,
      slug: episodeDraft.slug || slugify(episodeDraft.title),
      publishedAt:
        episodeDraft.published && !episodeDraft.publishedAt
          ? new Date().toISOString()
          : episodeDraft.publishedAt,
    };
    try {
      if (episodeDraft.id) await adminApi.growthUpdate("episodes", episodeDraft.id, payload);
      else await adminApi.growthCreate("episodes", payload);
      toast.success(episodeDraft.id ? "Episode saved" : "Episode added");
      setEpisodeDraft(null);
      loadDetail(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "episode"));
    }
  }

  async function removeEpisode(ep: PodcastEpisode) {
    const ok = await confirm({
      title: `Delete “${ep.title}”?`,
      description: "Listeners won't be able to play it any more.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok || !active) return;
    try {
      await adminApi.growthDelete("episodes", ep.id);
      toast.success("Episode deleted");
      loadDetail(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "episode"));
    }
  }

  async function createPrivateLink(memberId?: number) {
    if (!active) return;
    try {
      await adminApi.feedTokenCreate(active.id, memberId);
      toast.success("Private link created — copy it and send it to your listener.");
      loadDetail(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "private link"));
    }
  }

  async function turnOffPrivateLink(link: FeedToken) {
    if (!active) return;
    try {
      await adminApi.feedTokenRevoke(link.id);
      toast.success("That link no longer works.");
      loadDetail(active.id);
    } catch (err) {
      toast.error(friendlyError(err, "private link"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Podcasts"
        description="Publish a public show, or a members-only one. Listeners subscribe in Apple Podcasts, Spotify and the rest."
        actions={
          <Button size="sm" onClick={() => setShowDraft({ ...EMPTY_SHOW })}>
            <Plus />
            New show
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {shows === null ? (
        <Skeleton className="h-64 w-full" />
      ) : shows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Mic />}
            title="No shows yet"
            description="Set up your show, add your first episode, and people can listen wherever they get their podcasts."
            action={
              <Button size="sm" onClick={() => setShowDraft({ ...EMPTY_SHOW })}>
                Create a show
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Your shows" />
            <ul className="space-y-0.5 p-2">
              {shows.map((show) => (
                <li key={show.id}>
                  <button
                    type="button"
                    onClick={() => setActive(show)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active?.id === show.id
                        ? "bg-lilac-tint font-semibold text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <Mic className="size-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{show.title}</span>
                    {show.visibility === "private" && (
                      <span className="shrink-0 text-[0.6rem] font-bold uppercase text-gold-muted">
                        Members
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-5">
            {active && (
              <Card>
                <CardHeader
                  title={active.title}
                  subtitle={`${VISIBILITY_LABEL[active.visibility] ?? "Anyone can listen"} · ${active.author}`}
                  icon={<Headphones className="size-4" />}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setShowDraft(active)}>
                      Edit show
                    </Button>
                  }
                />
                <div className="p-5">
                  <p className="text-sm font-semibold text-ink">Your show's listening link</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {active.visibility === "private"
                      ? "This show is members only, so this link won't play on its own — each listener needs their own private link. Create one for each person below."
                      : "Paste this into Apple Podcasts, Spotify or any other listening app to list your show."}
                  </p>
                  {/* The address itself is never printed. It isn't one she'd
                      recognise or ever type, and reading it back only invites
                      the question "what's that?" — copying is the only thing
                      anyone does with it, so that's all the row offers. */}
                  <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                      Your show's address
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        await navigator.clipboard.writeText(listeningLink);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? <Check /> : <Copy />}
                      Copy
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            <Card>
              <CardHeader
                title="Episodes"
                subtitle={episodes ? pluralize(episodes.length, "episode") : undefined}
                action={
                  <Button
                    size="sm"
                    onClick={() => setEpisodeDraft({ season: 1, published: true })}
                    disabled={!active}
                  >
                    <Plus />
                    Add an episode
                  </Button>
                }
              />
              {episodes === null ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : episodes.length === 0 ? (
                <EmptyState
                  icon={<Mic />}
                  title="No episodes yet"
                  description="Add your first episode and upload the audio — it'll appear here."
                />
              ) : (
                <ul className="divide-y divide-hairline/60">
                  {episodes.map((ep) => (
                    <motion.li
                      key={ep.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-wrap items-center gap-3 px-5 py-3.5"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
                        <Mic className="size-4" />
                      </span>
                      <button
                        type="button"
                        onClick={() => setEpisodeDraft(ep)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate font-semibold text-ink">
                          {ep.episodeNumber ? `${ep.episodeNumber}. ` : ""}
                          {ep.title}
                        </span>
                        <span className="block truncate text-xs text-ink-soft">
                          {ep.audioUrl ? "Ready to play" : "No audio yet"}
                          {ep.durationSeconds > 0
                            ? ` · ${Math.round(ep.durationSeconds / 60)} min`
                            : ""}
                        </span>
                      </button>
                      <Badge tone={ep.published ? "green" : "slate"}>
                        {ep.published ? "Live" : "Not visible yet"}
                      </Badge>
                      <Button
                        variant="dangerGhost"
                        size="iconSm"
                        aria-label={`Delete ${ep.title}`}
                        onClick={() => removeEpisode(ep)}
                      >
                        <Trash2 />
                      </Button>
                    </motion.li>
                  ))}
                </ul>
              )}
            </Card>

            {active?.visibility === "private" && (
              <Card>
                <CardHeader
                  title="Private listening links"
                  subtitle="One for each listener"
                  icon={<Headphones className="size-4" />}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => createPrivateLink()}>
                      <Plus />
                      Create a link
                    </Button>
                  }
                />
                <div className="border-b border-hairline/60 px-5 py-3">
                  <p className="text-xs leading-relaxed text-ink-soft">
                    A private link lets one person listen to this show in their usual podcast app.
                    Send each member their own — if someone leaves, turn their link off and only
                    they lose access.
                  </p>
                </div>
                {links === null ? (
                  <Skeleton className="m-5 h-12" />
                ) : links.length === 0 ? (
                  <EmptyState
                    icon={<Headphones />}
                    title="No private links yet"
                    description="Create one for each member who should be able to listen."
                  />
                ) : (
                  <ul className="divide-y divide-hairline/60">
                    {links.map((link) => (
                      <li key={link.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">
                            {link.memberEmail || "For anyone you send it to"}
                          </p>
                          <p className="truncate text-xs text-ink-soft">
                            Created {formatDate(link.createdAt)}
                          </p>
                        </div>
                        {link.revoked ? (
                          <Badge tone="slate">Turned off</Badge>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                navigator.clipboard
                                  .writeText(privateLink(link.token))
                                  .then(() =>
                                    toast.success("Link copied — send it to your listener."),
                                  )
                              }
                            >
                              <Copy />
                              Copy link
                            </Button>
                            <Button
                              variant="dangerGhost"
                              size="sm"
                              onClick={() => turnOffPrivateLink(link)}
                            >
                              Turn off
                            </Button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-hairline/60 p-4">
                  <Field label="Create a link for one of your members">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          createPrivateLink(Number(e.target.value));
                          e.target.value = "";
                        }
                      }}
                      className={selectStyles}
                    >
                      <option value="">Choose a member…</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name ? `${m.name} — ${m.email}` : m.email}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Show editor */}
      <Modal
        open={showDraft !== null}
        onOpenChange={(open) => !open && setShowDraft(null)}
        title={showDraft?.id ? "Edit show" : "New show"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="show-form">
              Save show
            </Button>
          </>
        }
      >
        {showDraft && (
          <form id="show-form" onSubmit={saveShow} className="grid gap-4 sm:grid-cols-2">
            <Field label="Show name" className="sm:col-span-2">
              <Input
                value={showDraft.title ?? ""}
                onChange={(e) => setShowDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="The Boss Clinician Show"
                required
                autoFocus
              />
            </Field>
            <Field
              label="What's the show about?"
              hint="listening apps show this under your title"
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                value={showDraft.description ?? ""}
                onChange={(e) => setShowDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field label="Hosted by">
              <Input
                value={showDraft.author ?? ""}
                onChange={(e) => setShowDraft((d) => ({ ...d, author: e.target.value }))}
              />
            </Field>
            <Field label="Category" hint="how listening apps file your show">
              <select
                value={showDraft.category || "Business"}
                onChange={(e) => setShowDraft((d) => ({ ...d, category: e.target.value }))}
                className={selectStyles}
              >
                {/* A show set up before this list existed keeps whatever it has,
                    so saving can never quietly change where it's filed. */}
                {(showDraft.category && !CATEGORIES.includes(showDraft.category)
                  ? [showDraft.category, ...CATEGORIES]
                  : CATEGORIES
                ).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Cover picture"
              hint="the square artwork people see in their podcast app"
              className="sm:col-span-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                {showDraft.coverImage ? (
                  <img
                    src={showDraft.coverImage}
                    alt=""
                    className="size-16 shrink-0 rounded-xl border border-hairline object-cover"
                  />
                ) : (
                  <span className="grid size-16 shrink-0 place-items-center rounded-xl border border-dashed border-hairline text-ink-soft">
                    <ImageIcon className="size-5" />
                  </span>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => openPicker("cover")}
                >
                  {showDraft.coverImage ? "Replace" : "Choose a picture"}
                </Button>
                {showDraft.coverImage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDraft((d) => ({ ...d, coverImage: "" }))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </Field>

            <Field label="Who can listen?" hint="members get their own private link">
              <select
                value={showDraft.visibility ?? "public"}
                onChange={(e) => setShowDraft((d) => ({ ...d, visibility: e.target.value }))}
                className={selectStyles}
              >
                <option value="public">Anyone</option>
                <option value="private">Members only</option>
              </select>
            </Field>
            <div className="flex items-end gap-5">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(showDraft.explicit)}
                  onChange={(e) => setShowDraft((d) => ({ ...d, explicit: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum"
                />
                Contains adult language
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={showDraft.published !== false}
                  onChange={(e) => setShowDraft((d) => ({ ...d, published: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum"
                />
                {publishLabel(showDraft.published !== false)}
              </label>
            </div>
          </form>
        )}
      </Modal>

      {/* Episode editor */}
      <Modal
        open={episodeDraft !== null}
        onOpenChange={(open) => !open && setEpisodeDraft(null)}
        title={episodeDraft?.id ? "Edit episode" : "New episode"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEpisodeDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="episode-form">
              Save episode
            </Button>
          </>
        }
      >
        {episodeDraft && (
          <form id="episode-form" onSubmit={saveEpisode} className="space-y-4">
            <Field label="Episode title">
              <Input
                value={episodeDraft.title ?? ""}
                onChange={(e) => setEpisodeDraft((d) => ({ ...d, title: e.target.value }))}
                required
                autoFocus
              />
            </Field>

            <Field label="The audio" hint="what people press play on">
              <div className="space-y-2.5">
                {episodeDraft.audioUrl && (
                  <audio
                    src={episodeDraft.audioUrl}
                    controls
                    className="w-full"
                    // Reading the length straight off the file saves her working
                    // it out; it only fills a length she hasn't set herself.
                    onLoadedMetadata={(e) => {
                      const seconds = Math.round(e.currentTarget.duration);
                      if (!Number.isFinite(seconds) || seconds <= 0) return;
                      setEpisodeDraft((d) =>
                        d && !d.durationSeconds ? { ...d, durationSeconds: seconds } : d,
                      );
                    }}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => openPicker("audio")}
                  >
                    {episodeDraft.audioUrl ? "Replace the audio" : "Choose from my files"}
                  </Button>
                  {episodeDraft.audioUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEpisodeDraft((d) => ({ ...d, audioUrl: "", audioBytes: 0 }))
                      }
                    >
                      Remove
                    </Button>
                  )}
                  {!episodeDraft.audioUrl && (
                    <span className="self-center text-xs text-ink-soft">
                      No audio yet — nothing will play until you add one.
                    </span>
                  )}
                </div>
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Episode number">
                <Input
                  type="number"
                  min={0}
                  value={episodeDraft.episodeNumber ?? ""}
                  onChange={(e) =>
                    setEpisodeDraft((d) => ({ ...d, episodeNumber: Number(e.target.value) || null }))
                  }
                />
              </Field>
              <Field label="Season">
                <Input
                  type="number"
                  min={1}
                  value={episodeDraft.season ?? 1}
                  onChange={(e) => setEpisodeDraft((d) => ({ ...d, season: Number(e.target.value) }))}
                />
              </Field>
              <Field label="How long is it?" hint="in minutes">
                <Input
                  type="number"
                  min={0}
                  value={
                    episodeDraft.durationSeconds
                      ? Math.round(episodeDraft.durationSeconds / 60)
                      : ""
                  }
                  onChange={(e) =>
                    setEpisodeDraft((d) => ({
                      ...d,
                      durationSeconds: Math.max(0, Number(e.target.value) || 0) * 60,
                    }))
                  }
                />
              </Field>
            </div>

            <Field label="Show notes" hint="what people read next to the episode">
              <BodyEditor
                value={episodeDraft.showNotesMd ?? ""}
                onChange={(next) => setEpisodeDraft((d) => ({ ...d, showNotesMd: next }))}
                rows={6}
                placeholder="What this episode covers, and anything you mention in it."
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={episodeDraft.published !== false}
                onChange={(e) => setEpisodeDraft((d) => ({ ...d, published: e.target.checked }))}
                className="size-4 rounded border-hairline text-plum"
              />
              {episodeDraft.published !== false
                ? "Live — listeners can play it"
                : "Not visible yet"}
            </label>
          </form>
        )}
      </Modal>

      <MediaPicker
        kind={pickerKind}
        open={picking !== null}
        onOpenChange={(open) => !open && setPicking(null)}
        onSelect={(asset) => {
          if (picking === "cover") {
            setShowDraft((d) => (d ? { ...d, coverImage: asset.url } : d));
          } else {
            // Clearing the length lets the player below read it back off the new
            // file — the old one belonged to the audio she just replaced.
            setEpisodeDraft((d) =>
              d
                ? {
                    ...d,
                    audioUrl: asset.url,
                    audioBytes: Number(asset.sizeBytes),
                    durationSeconds: 0,
                  }
                : d,
            );
          }
          setPicking(null);
        }}
        onUseWebAddress={(webAddress) => {
          if (picking === "cover") {
            setShowDraft((d) => (d ? { ...d, coverImage: webAddress } : d));
          } else {
            // Nothing is known about a file we didn't take in ourselves, so the
            // size and length start empty; the player reads the length back.
            setEpisodeDraft((d) =>
              d ? { ...d, audioUrl: webAddress, audioBytes: 0, durationSeconds: 0 } : d,
            );
          }
          setPicking(null);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/**
 * Picks a file she has already uploaded — or takes a new one there and then.
 * Replaces the two path boxes that used to sit on these forms; she never types
 * or reads a file path.
 *
 * The web-address box at the bottom keeps the one thing those path boxes were
 * genuinely good for: audio or artwork that already lives somewhere else, which
 * is common for podcasters who host their episodes with another service.
 */
function MediaPicker({
  kind,
  open,
  onOpenChange,
  onSelect,
  onUseWebAddress,
}: {
  kind: "audio" | "image";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: MediaAsset) => void;
  onUseWebAddress: (address: string) => void;
}) {
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (!open) return;
    // Reset first so switching between audio and pictures never shows the
    // previous list for a moment.
    setAssets(null);
    setAddress("");
    adminApi.mediaList(kind).then(setAssets).catch(() => setAssets([]));
  }, [open, kind]);

  const isAudio = kind === "audio";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isAudio ? "Choose an audio file" : "Choose a picture"}
      size="lg"
    >
      <div className="space-y-5">
        <UploadDropzone
          compact
          accept={isAudio ? "audio/*" : "image/*"}
          onUploaded={(asset) => setAssets((prev) => (prev ? [asset, ...prev] : [asset]))}
        />
        {assets === null ? (
          <Skeleton className="h-24 w-full" />
        ) : assets.length === 0 ? (
          <EmptyState
            icon={isAudio ? <Mic /> : <ImageIcon />}
            title={isAudio ? "No audio yet" : "No pictures yet"}
            description={
              isAudio
                ? "Drop an audio file above to get started."
                : "Drop a picture above to get started."
            }
          />
        ) : (
          <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => onSelect(asset)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-lilac-tint/30"
                >
                  {isAudio ? (
                    <Mic className="size-4 shrink-0 text-plum" />
                  ) : (
                    <img
                      src={asset.url}
                      alt=""
                      className="size-9 shrink-0 rounded-lg border border-hairline object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {asset.title || asset.originalName}
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">
                    {formatBytes(Number(asset.sizeBytes))} · {formatDate(asset.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-hairline/60 pt-4">
          <Field
            label={isAudio ? "Already hosted somewhere else?" : "Using a picture from elsewhere?"}
            hint="paste its web address"
          >
            <div className="flex gap-2">
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="https://…"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={!address.trim()}
                onClick={() => onUseWebAddress(address.trim())}
              >
                Use this
              </Button>
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

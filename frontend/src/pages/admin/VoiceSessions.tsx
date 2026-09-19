import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  MessagesSquare,
  Mic,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
  chipRowStyles,
} from "@/pages/admin/ui/primitives";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * What people asked the assistant.
 *
 * Boss Clinician AI talks to visitors on the website, to members in their
 * portal and to Yvette in here — and every one of those conversations is a
 * customer saying, in their own words, what they wanted and could not find.
 * That is the most useful writing on this whole platform, and until this screen
 * nobody could read a line of it.
 *
 * So the page is written for reading, not for auditing: it says "she asked
 * about pricing", not "session 9f1c". The words the assistant was approved to
 * act on in this admin get their own trail underneath, because "did I agree to
 * that?" is a different question from "what did she ask".
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const PAGE_SIZE = 25;

/** A conversation is "still going" while something arrived in the last minute or two. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }
  // A 204 has no body to parse; the only caller that sees one returns void.
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

type Surface = "public" | "member" | "admin";
type Mode = "voice" | "text";

interface ConversationSummary {
  id: string;
  surface: Surface;
  mode: Mode;
  personName: string;
  personEmail: string;
  startedAt: string;
  endedAt: string | null;
  ended: boolean;
  lastSeenAt: string;
  seconds: number | null;
  endReason: string;
  path: string;
  lineCount: number;
  approvalCount: number;
  hasRecording: boolean;
}

interface TranscriptLine {
  id: string;
  role: "user" | "agent";
  text: string;
  atMs: number;
}

interface ApprovalEntry {
  id: string;
  actionId: string;
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  risk: string;
  approved: boolean;
  answeredVia: string;
  note: string;
  executed: boolean;
  createdAt: string;
}

interface ConversationDetail extends ConversationSummary {
  transcript: TranscriptLine[];
  approvals: ApprovalEntry[];
  recordingBytes: number | null;
}

interface ConversationPage {
  items: ConversationSummary[];
  total: number;
}

const conversationsApi = {
  list: (filters: { surface?: Surface; mode?: Mode; withRecording?: boolean }, page: number) => {
    const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (filters.surface) query.set("surface", filters.surface);
    if (filters.mode) query.set("mode", filters.mode);
    if (filters.withRecording) query.set("withRecording", "true");
    return request<ConversationPage>(`/admin/voice-sessions?${query.toString()}`);
  },
  detail: (id: string) => request<ConversationDetail>(`/admin/voice-sessions/${id}`),
  recording: (id: string) =>
    request<{ url: string; expiresAt: string; contentType: string }>(
      `/admin/voice-sessions/${id}/recording`,
    ),
  remove: (id: string) =>
    request<void>(`/admin/voice-sessions/${id}`, { method: "DELETE" }),
};

/* ------------------------------------------------------------ her wording */

const WHERE_LABEL: Record<Surface, string> = {
  public: "On the website",
  member: "In the member portal",
  admin: "In here, with you",
};

/**
 * How a conversation finished, in words rather than in the machine's.
 *
 * Anything the assistant reports that is not in this list is shown as it came,
 * tidied up — a new kind of ending should read a little oddly rather than
 * disappear off the page.
 */
const ENDING_LABEL: Record<string, string> = {
  finished: "Finished",
  "hung up": "They ended it",
  "time limit": "Reached the time limit",
  "lost connection": "The connection dropped",
  error: "Something went wrong",
};

function endingLabel(row: ConversationSummary): string {
  if (!row.ended) {
    const quiet = Date.now() - new Date(row.lastSeenAt).getTime();
    // A call nobody closed: either it is happening right now, or the tab was
    // shut and it never said goodbye. Both are true things to say.
    return quiet < LIVE_WINDOW_MS ? "Happening now" : "Left without finishing";
  }
  if (!row.endReason) return "Finished";
  // The assistant writes these as one word or two, hyphenated or not
  // ("time-limit"), so the lookup is done on a flattened version rather than
  // on the exact spelling of the day.
  const tidied = row.endReason.toLowerCase().replace(/[-_]+/g, " ").trim();
  return ENDING_LABEL[tidied] ?? tidied.charAt(0).toUpperCase() + tidied.slice(1);
}

/** "4 minutes", "45 seconds" — never "252s". */
function lengthLabel(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "A moment";
  if (seconds < 90) return pluralize(seconds, "second");
  return pluralize(Math.round(seconds / 60), "minute");
}

function personLabel(row: ConversationSummary): string {
  return row.personName || row.personEmail || "Someone not signed in";
}

/** How the owner answered the assistant, said out loud rather than in codes. */
const ANSWERED_LABEL: Record<string, string> = {
  voice: "out loud",
  chat: "in the chat",
  click: "by clicking",
  timeout: "not at all",
  cancelled: "by cancelling",
};

/* ------------------------------------------------------------------- page */

export default function VoiceSessions() {
  const [surface, setSurface] = useState<Surface | "">("");
  const [mode, setMode] = useState<Mode | "">("");
  const [withRecording, setWithRecording] = useState(false);
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ConversationSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    setRows(null);
    conversationsApi
      .list(
        {
          surface: surface || undefined,
          mode: mode || undefined,
          withRecording,
        },
        page,
      )
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => {
        setRows([]);
        setTotal(0);
        setError(friendlyError(err, "conversations"));
      });
  }, [surface, mode, withRecording, page]);

  useEffect(load, [load]);

  async function remove(row: ConversationSummary) {
    const ok = await confirm({
      title: "Delete this conversation?",
      description:
        "The whole conversation goes, including the recording. Nobody can get it back afterwards.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await conversationsApi.remove(row.id);
      toast.success("Conversation deleted");
      if (openId === row.id) setOpenId(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "conversation"));
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = surface !== "" || mode !== "" || withRecording;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Boss Clinician AI"
        title="Voice conversations"
        description="Everything people have asked the assistant — on the website, in the member portal and in here. What they said, how long they stayed, and the recording where there is one."
      />

      <Card>
        <div className="space-y-4 px-5 py-5">
          <div>
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
              Where they were
            </p>
            <div className={chipRowStyles}>
              <Chip selected={surface === ""} onClick={() => { setSurface(""); setPage(1); }}>
                Everywhere
              </Chip>
              {(["public", "member", "admin"] as const).map((value) => (
                <Chip
                  key={value}
                  selected={surface === value}
                  onClick={() => { setSurface(value); setPage(1); }}
                >
                  {WHERE_LABEL[value]}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
              How they talked to it
            </p>
            <div className={chipRowStyles}>
              <Chip selected={mode === ""} onClick={() => { setMode(""); setPage(1); }}>
                Either way
              </Chip>
              <Chip selected={mode === "voice"} onClick={() => { setMode("voice"); setPage(1); }}>
                Out loud
              </Chip>
              <Chip selected={mode === "text"} onClick={() => { setMode("text"); setPage(1); }}>
                Typed
              </Chip>
              <Chip
                selected={withRecording}
                onClick={() => { setWithRecording(!withRecording); setPage(1); }}
              >
                Only ones I can listen to
              </Chip>
            </div>
          </div>
        </div>
      </Card>

      {error && <ErrorNotice message={error} />}

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.8)]">
        <div className="overflow-x-auto">
          <table className="admin-data-table w-full text-left text-sm" style={{ minWidth: "820px" }}>
            <thead className="bg-sand">
              <tr>
                {["When", "Who", "Where", "How long", "How it finished"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap px-5 py-3 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft"
                  >
                    {heading}
                  </th>
                ))}
                <th scope="col" className="w-28 px-3 py-3">
                  <span className="sr-only">Read it</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {rows === null ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }, (_cell, ci) => (
                      <td key={ci} className="h-11 px-5 py-2">
                        <Skeleton className={cn("h-4", ci === 5 ? "w-10" : "w-24")} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={<MessagesSquare />}
                      title={filtered ? "Nothing matches" : "No conversations yet"}
                      description={
                        filtered
                          ? "Try widening the filters above."
                          : "As soon as somebody talks to Boss Clinician AI, the conversation will be here."
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-surface-raised">
                    <td className="whitespace-nowrap px-5 py-2.5 align-middle text-xs text-ink-soft">
                      {formatDateTime(row.startedAt)}
                    </td>
                    <td data-label="Who" className="px-5 py-2.5 align-middle">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{personLabel(row)}</p>
                        {row.personName && row.personEmail && (
                          <p className="truncate text-xs text-ink-soft">{row.personEmail}</p>
                        )}
                      </div>
                    </td>
                    <td data-label="Where" className="px-5 py-2.5 align-middle">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-ink">{WHERE_LABEL[row.surface]}</span>
                        <Badge tone={row.mode === "voice" ? "gold" : "slate"}>
                          {row.mode === "voice" ? (
                            <>
                              <Mic className="size-3" /> Out loud
                            </>
                          ) : (
                            <>
                              <Keyboard className="size-3" /> Typed
                            </>
                          )}
                        </Badge>
                      </div>
                    </td>
                    <td data-label="How long" className="whitespace-nowrap px-5 py-2.5 align-middle text-ink">
                      {lengthLabel(row.seconds)}
                      <span className="ml-1.5 text-xs text-ink-soft">
                        · {pluralize(row.lineCount, "line")}
                      </span>
                    </td>
                    <td data-label="How it finished" className="px-5 py-2.5 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink">{endingLabel(row)}</span>
                        {row.hasRecording && <Badge tone="green">Recording</Badge>}
                        {row.approvalCount > 0 && (
                          <Badge tone="plum">{pluralize(row.approvalCount, "request")}</Badge>
                        )}
                      </div>
                    </td>
                    <td data-label="" className="px-3 py-1.5 text-right align-middle">
                      <Button type="button" variant="secondary" size="sm" onClick={() => setOpenId(row.id)}>
                        Read it
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {rows !== null && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline/60 px-4 py-3">
            <p className="text-xs text-ink-soft">
              {pluralize(total, "conversation")} in total
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft />
                Newer
              </Button>
              <span className="text-xs text-ink-soft">
                Page {page} of {pageCount}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Older
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </div>

      {openId !== null && (
        <ConversationPanel
          id={openId}
          onClose={() => setOpenId(null)}
          onDelete={(row) => remove(row)}
        />
      )}

      {confirmDialog}
    </div>
  );
}

/* ----------------------------------------------------------- one of them */

function ConversationPanel({
  id,
  onClose,
  onDelete,
}: {
  id: string;
  onClose: () => void;
  onDelete: (row: ConversationSummary) => void;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    conversationsApi
      .detail(id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, "conversation"));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline/60 px-5 py-4">
        <div className="min-w-0">
          <p className="font-display text-lg text-ink">
            {detail ? personLabel(detail) : "Opening the conversation"}
          </p>
          {detail && (
            <p className="mt-1 text-sm text-ink-soft">
              {formatDateTime(detail.startedAt)} · {WHERE_LABEL[detail.surface]} ·{" "}
              {detail.mode === "voice" ? "Spoken" : "Typed"} · {lengthLabel(detail.seconds)}
              {detail.path ? ` · started on ${detail.path}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {detail && (
            <Button type="button" variant="dangerGhost" size="sm" onClick={() => onDelete(detail)}>
              <Trash2 />
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" size="iconSm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div className="space-y-6 px-5 py-5">
        {error && <ErrorNotice message={error} />}

        {detail === null && !error && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}

        {detail && detail.hasRecording && <RecordingPlayer id={detail.id} />}

        {detail && detail.approvals.length > 0 && (
          <div>
            <h2 className="mb-2 font-display text-base text-ink">What it asked to do</h2>
            <ul className="space-y-2">
              {detail.approvals.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-hairline bg-white/[0.02] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{entry.title || "A change"}</p>
                    <Badge tone={entry.approved ? "green" : "red"}>
                      {entry.approved ? "You said yes" : "You said no"}
                    </Badge>
                    {entry.approved && (
                      <Badge tone={entry.executed ? "blue" : "gold"}>
                        {entry.executed ? "It went ahead" : "It did not run"}
                      </Badge>
                    )}
                    {entry.risk === "destructive" && <Badge tone="red">Serious change</Badge>}
                  </div>
                  {entry.summary && <p className="mt-1.5 text-sm text-ink-soft">{entry.summary}</p>}
                  {entry.details.length > 0 && (
                    <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      {entry.details.map((line, index) => (
                        <div key={index} className="flex gap-2 text-xs">
                          <dt className="text-ink-soft">{line.label}</dt>
                          <dd className="min-w-0 break-words text-ink">{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="mt-2 text-xs text-ink-soft">
                    You answered {ANSWERED_LABEL[entry.answeredVia] ?? entry.answeredVia}
                    {entry.note ? ` — "${entry.note}"` : ""} · {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {detail && (
          <div>
            <h2 className="mb-2 font-display text-base text-ink">What was said</h2>
            {detail.transcript.length === 0 ? (
              <p className="rounded-xl border border-hairline/60 px-4 py-3 text-sm text-ink-soft">
                Nothing was written down for this one — it ended before anybody spoke.
              </p>
            ) : (
              <ol className="space-y-2">
                {detail.transcript.map((line) => (
                  <li
                    key={line.id}
                    className={cn(
                      "max-w-[46rem] rounded-2xl px-4 py-2.5 text-sm",
                      line.role === "user"
                        ? "bg-white/[0.05] text-ink"
                        : "ml-auto bg-plum-bright/[0.14] text-ink",
                    )}
                  >
                    <p className="mb-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                      {line.role === "user" ? personLabel(detail) : "Boss Clinician AI"}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{line.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * The audio, fetched only when somebody opens the conversation.
 *
 * The link is deliberately short-lived, so the one thing this has to handle is
 * it going stale while the panel sits open: the player asks for a fresh one on
 * the first error and only once, because a link that fails twice is a recording
 * that is genuinely not there and a loop would hide that.
 */
function RecordingPlayer({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retried = useRef(false);

  const fetchUrl = useCallback(() => {
    conversationsApi
      .recording(id)
      .then((res) => {
        setUrl(res.url);
        setError(null);
      })
      .catch((err) => setError(friendlyError(err, "recording")));
  }, [id]);

  useEffect(() => {
    retried.current = false;
    fetchUrl();
  }, [fetchUrl]);

  if (error) {
    return (
      <p className="rounded-xl border border-hairline/60 px-4 py-3 text-sm text-ink-soft">{error}</p>
    );
  }

  return (
    <div>
      <h2 className="mb-2 font-display text-base text-ink">Listen to it</h2>
      {url === null ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <audio
          controls
          className="w-full"
          src={url}
          onError={() => {
            if (retried.current) {
              setError("That recording could not be played.");
              return;
            }
            retried.current = true;
            fetchUrl();
          }}
        />
      )}
      <p className="mt-1.5 text-xs text-ink-soft">
        Only you can play this, and the link stops working after a few minutes.
      </p>
    </div>
  );
}

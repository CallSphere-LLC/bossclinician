import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import * as Tabs from "@radix-ui/react-tabs";
import { Download, Mail, PlayCircle, Radio, RefreshCw, Search, SearchX, Users } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime, formatRelative } from "@/lib/format";
import { saveCsv } from "@/lib/formsApi";
import {
  engagementApi,
  personKey,
  type EmailCopy,
  type EngagementCourse,
  type EngagementLesson,
  type EngagementSendRow,
  type LiveSessionSummary,
  type ProgressResponse,
  type SessionPerson,
  type StatusFilter,
} from "@/lib/engagementApi";
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
import { Modal } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";
import {
  INVITED_AS_LABEL,
  LESSON_TOKENS,
  REPLAY_TOKENS,
  WATCH_STATUS_LABEL,
  WATCH_STATUS_TONE,
  defaultReminderSelection,
  defaultReplaySelection,
  describeMinutes,
  describeSendResult,
  progressRowKey,
  reminderTarget,
} from "@/pages/admin/engagement/engagementHelpers";

/**
 * Analytics → Engagement (QA row 171).
 *
 * "Is there a way to see if a participant watched a video and send a reminder,
 * or if they didn't show up to a live session, send a replay?" — both halves on
 * one page. Lesson videos: every person × every video lesson, how far they got,
 * a CSV, and "Send reminder". Live sessions: every recent call, who was
 * invited and who came (from the live room's own record), the replay link, and
 * "Email the replay" to whoever missed it.
 *
 * Nothing on this page sends by itself: each send is a press, at most one email
 * per person per thing per day, through the same suppression and unsubscribe
 * rules as every other email. The automatic versions are Automations triggers
 * ("a lesson video has not been watched", "someone misses a live session"),
 * which are created paused.
 */

const TABS = [
  { value: "videos", label: "Lesson videos", icon: PlayCircle },
  { value: "live", label: "Live sessions", icon: Radio },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function tabFrom(value: string | null): TabValue {
  return value === "live" ? "live" : "videos";
}

/** Numbers in the body font, bold, with aligned digits — never the display serif. */
const NUMBER = "font-bold tabular-nums text-ink";

export default function VideoEngagement() {
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get("tab"));
  const [sendsVersion, setSendsVersion] = useState(0);
  const onSent = useCallback(() => setSendsVersion((value) => value + 1), []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Engagement"
        description="See who watched each lesson video and who came to each live session — then send a reminder, or the replay, to everyone else."
      />

      <Tabs.Root
        value={tab}
        onValueChange={(value) =>
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set("tab", tabFrom(value));
              return next;
            },
            { replace: true },
          )
        }
      >
        <Tabs.List className="flex gap-1 overflow-x-auto rounded-xl border border-hairline/70 bg-surface p-1.5">
          {TABS.map((item) => (
            <Tabs.Trigger
              key={item.value}
              value={item.value}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-plum sm:px-4 data-[state=active]:bg-brand-gradient data-[state=active]:text-white"
            >
              <item.icon className="size-4" />
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="mt-5">
          <Tabs.Content value="videos">
            <VideosTab onSent={onSent} />
          </Tabs.Content>
          <Tabs.Content value="live">
            <LiveTab onSent={onSent} />
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <RecentSends version={sendsVersion} />

      <Card className="p-5 text-sm text-ink-soft">
        <p>
          <span className="font-semibold text-ink">Want these to go out by themselves?</span> In{" "}
          <Link to="/admin/marketing/automations-v2" className="text-gold underline-offset-4 hover:underline">
            Automations
          </Link>
          , start one with “a lesson video has not been watched” (choose the course and how many days),
          or “someone misses a live session”, then add a “send them an email” step using{" "}
          <code className="text-ink">{"{{lessonUrl}}"}</code> or <code className="text-ink">{"{{replayUrl}}"}</code>.
          New automations start paused, and only people who become due after you turn one on are emailed.
        </p>
      </Card>
    </div>
  );
}

/* ================================================================ videos */

function VideosTab({ onSent }: { onSent: () => void }) {
  const [courses, setCourses] = useState<EngagementCourse[] | null>(null);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [lessons, setLessons] = useState<EngagementLesson[]>([]);
  const [lessonId, setLessonId] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    engagementApi
      .courses()
      .then((rows) => {
        setCourses(rows);
        if (rows.length > 0) setCourseId((current) => current ?? rows[0].id);
      })
      .catch((err) => setError(friendlyError(err, "course")));
  }, []);

  useEffect(() => {
    setLessonId(null);
    setLessons([]);
    if (!courseId) return;
    engagementApi
      .lessons(courseId)
      .then(setLessons)
      .catch((err) => setError(friendlyError(err, "course")));
  }, [courseId]);

  // The search box waits for a pause in typing before it asks again.
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filters = useMemo(
    () => ({ courseId, lessonId, status, q }),
    [courseId, lessonId, status, q],
  );

  const load = useCallback(async () => {
    if (!filters.courseId && filters.q.length < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await engagementApi.progress(filters);
      setData(next);
      setSelected(defaultReminderSelection(next.rows));
    } catch (err) {
      setError(friendlyError(err, "report"));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download() {
    setDownloading(true);
    try {
      const blob = await engagementApi.progressCsv(filters);
      saveCsv(blob, `video-engagement-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      toast.error(friendlyError(err, "download"));
    } finally {
      setDownloading(false);
    }
  }

  const rows = data?.rows ?? [];
  const target = reminderTarget(rows, selected);
  const allTicked = rows.length > 0 && rows.every((row) => selected.has(progressRowKey(row)));

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (courses === null && !error) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Course">
          <select
            className={selectStyles}
            value={courseId ?? ""}
            onChange={(event) => setCourseId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Every course (search for a person)</option>
            {(courses ?? []).map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lesson">
          <select
            className={selectStyles}
            value={lessonId ?? ""}
            disabled={!courseId}
            onChange={(event) => setLessonId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Every video lesson</option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.moduleTitle ? `${lesson.moduleTitle} — ` : ""}
                {lesson.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Show">
          <select
            className={selectStyles}
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          >
            <option value="all">Everyone</option>
            <option value="not_completed">Not finished yet</option>
            <option value="not_started">Not started</option>
            <option value="partial">Partly watched</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        <Field label="Person">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
            <Input
              className="pl-9"
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </Field>
      </Card>

      {error && <ErrorNotice message={error} />}

      {courseId && !lessonId && lessons.length > 0 && (
        <Card>
          <CardHeader
            title="Video lessons in this course"
            subtitle="Choose one to see exactly who has and hasn't watched it."
          />
          <ul className="divide-y divide-hairline/60">
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() => setLessonId(lesson.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{lesson.title}</span>
                    {lesson.moduleTitle && (
                      <span className="block truncate text-xs text-ink-soft">{lesson.moduleTitle}</span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-4 text-xs text-ink-soft">
                    <span>
                      <span className={NUMBER}>{lesson.completed}</span> completed
                    </span>
                    <span>
                      <span className={NUMBER}>{lesson.partial}</span> part way
                    </span>
                    <span>
                      <span className={NUMBER}>{lesson.notStarted}</span> not started
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Who watched what"
          subtitle={
            data
              ? `${data.totals.completed} completed · ${data.totals.partial} part way · ${data.totals.notStarted} not started`
              : "Choose a course, or search for a person."
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
                <RefreshCw />
                Refresh
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void download()} disabled={!data || downloading}>
                <Download />
                {downloading ? "Preparing…" : "Download CSV"}
              </Button>
              <Button
                size="sm"
                disabled={"problem" in target}
                title={"problem" in target ? target.problem : undefined}
                onClick={() => setComposing(true)}
              >
                <Mail />
                Send reminder{"memberIds" in target ? ` (${target.memberIds.length})` : ""}
              </Button>
            </div>
          }
        />
        {"problem" in target && selected.size > 0 && (
          <p className="border-b border-hairline/60 px-5 py-2 text-xs text-ink-soft">{target.problem}</p>
        )}
        {data?.truncated && (
          <p className="border-b border-hairline/60 px-5 py-2 text-xs text-ink-soft">
            Showing the first 5,000 rows. Choose a lesson or a status to narrow it, or download the CSV.
          </p>
        )}

        {loading && !data ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={data ? "Nobody matches these filters" : "Nothing to show yet"}
            description={
              data
                ? "Try a different lesson or status."
                : "Pick a course above, or type at least two letters of somebody's name."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-hairline/60 text-left text-xs uppercase tracking-[0.08em] text-ink-soft">
                  <th className="w-10 px-5 py-3">
                    <input
                      type="checkbox"
                      aria-label="Tick everyone shown"
                      checked={allTicked}
                      onChange={() =>
                        setSelected(allTicked ? new Set() : new Set(rows.map(progressRowKey)))
                      }
                    />
                  </th>
                  <th className="px-3 py-3 font-semibold">Person</th>
                  <th className="px-3 py-3 font-semibold">Lesson</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Watched</th>
                  <th className="px-3 py-3 font-semibold">Last watched</th>
                  <th className="px-3 py-3 font-semibold">Reminded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/50">
                {rows.map((row) => {
                  const key = progressRowKey(row);
                  return (
                    <tr key={key} className="align-top">
                      <td className="px-5 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Tick ${row.name || row.email}`}
                          checked={selected.has(key)}
                          onChange={() => toggle(key)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          className="text-left font-semibold text-ink hover:text-gold"
                          onClick={() => setSearch(row.email)}
                          title="Show every lesson for this person"
                        >
                          {row.name || row.email}
                        </button>
                        <div className="text-xs text-ink-soft [overflow-wrap:anywhere]">{row.email}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-ink">{row.lessonTitle}</div>
                        <div className="text-xs text-ink-soft">
                          {courseId ? row.moduleTitle : row.courseTitle}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={WATCH_STATUS_TONE[row.status]}>{WATCH_STATUS_LABEL[row.status]}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.08]">
                            <span
                              className="block h-full rounded-full bg-gold"
                              style={{ width: `${row.watchedPercent}%` }}
                            />
                          </span>
                          <span className={NUMBER}>{row.watchedPercent}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-soft">
                        {row.lastViewedAt ? formatRelative(row.lastViewedAt) : "Never opened"}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-soft">
                        {row.lastRemindedAt ? formatDateTime(row.lastRemindedAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {"memberIds" in target && data && (
        <ComposeModal
          open={composing}
          onOpenChange={setComposing}
          title={`Remind ${target.memberIds.length} ${target.memberIds.length === 1 ? "person" : "people"}`}
          description={`About “${target.lessonTitle}”. Each person gets their own link to the lesson.`}
          defaults={data.defaults}
          tokens={LESSON_TOKENS}
          submitLabel="Send reminder"
          onSubmit={async (copy) => {
            const result = await engagementApi.remind({
              lessonId: target.lessonId,
              memberIds: target.memberIds,
              ...copy,
            });
            toast.success(describeSendResult(result, "reminder"));
            onSent();
            void load();
          }}
        />
      )}
    </div>
  );
}

/* ================================================================== live */

function LiveTab({ onSent }: { onSent: () => void }) {
  const [sessions, setSessions] = useState<LiveSessionSummary[] | null>(null);
  const [defaults, setDefaults] = useState<EmailCopy | null>(null);
  const [error, setError] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await engagementApi.sessions(60);
      setSessions(result.sessions);
      setDefaults(result.defaults);
    } catch (err) {
      setError(friendlyError(err, "session"));
      setSessions((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (sessions === null) return <Skeleton className="h-96 rounded-2xl" />;

  const active = sessions.find((session) => session.key === activeKey) ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader
          title="Recent live sessions"
          subtitle="The last 60 days, newest first."
          action={
            <Button size="sm" variant="ghost" aria-label="Refresh the sessions" onClick={() => void load()}>
              <RefreshCw />
            </Button>
          }
        />
        {error && (
          <div className="p-4">
            <ErrorNotice message={error} />
          </div>
        )}
        {sessions.length === 0 ? (
          <EmptyState
            icon={<Radio />}
            title="No live sessions yet"
            description="Community events and webinars appear here once they have started."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {sessions.map((session) => (
              <li key={session.key}>
                <button
                  type="button"
                  onClick={() => setActiveKey(session.key)}
                  className={`w-full px-5 py-3 text-left transition-colors hover:bg-white/[0.04] ${
                    session.key === activeKey ? "bg-white/[0.06]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{session.title}</span>
                      <span className="block text-xs text-ink-soft">{session.dateLabel}</span>
                      <span className="block text-xs text-ink-soft">
                        {session.source === "community" ? session.communityName : "Webinar event"}
                      </span>
                    </span>
                    {session.replayUrl ? <Badge tone="green">Replay set</Badge> : <Badge>No replay</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-soft">
                    {session.attendanceTracked ? (
                      <>
                        <span>
                          <span className={NUMBER}>{session.attended ?? 0}</span> came
                        </span>
                        <span>
                          <span className={NUMBER}>{session.missed ?? 0}</span> missed it
                        </span>
                      </>
                    ) : (
                      <span>Attendance not tracked (external link)</span>
                    )}
                    <span>
                      <span className={NUMBER}>{session.invited ?? 0}</span> RSVP’d
                    </span>
                    {session.ended === false && <Badge tone="blue">On now</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {active ? (
        <SessionPanel
          key={active.key}
          session={active}
          defaults={defaults}
          onChanged={() => void load()}
          onSent={onSent}
        />
      ) : (
        <Card className="self-start">
          <EmptyState
            icon={<Users />}
            title="Choose a session"
            description="See who RSVP’d, who came and for how long, set the replay link, and email it to whoever missed it."
          />
        </Card>
      )}
    </div>
  );
}

function SessionPanel({
  session,
  defaults,
  onChanged,
  onSent,
}: {
  session: LiveSessionSummary;
  defaults: EmailCopy | null;
  onChanged: () => void;
  onSent: () => void;
}) {
  const [audience, setAudience] = useState<"registered" | "members">("registered");
  const [people, setPeople] = useState<SessionPerson[] | null>(null);
  const [error, setError] = useState("");
  const [replayUrl, setReplayUrl] = useState(session.replayUrl);
  const [savedReplay, setSavedReplay] = useState(session.replayUrl);
  const [saving, setSaving] = useState(false);
  const [includeAttendees, setIncludeAttendees] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await engagementApi.sessionPeople(session.key, audience);
      setPeople(result.people);
      setSelected(defaultReplaySelection(result.people, includeAttendees));
    } catch (err) {
      setError(friendlyError(err, "session"));
      setPeople((current) => current ?? []);
    }
  }, [session.key, audience, includeAttendees]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveReplay() {
    setSaving(true);
    try {
      await engagementApi.setReplay(session.key, replayUrl.trim());
      setSavedReplay(replayUrl.trim());
      toast.success(replayUrl.trim() ? "Replay link saved." : "Replay link removed.");
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "replay link"));
    } finally {
      setSaving(false);
    }
  }

  const ended = new Date(session.endsAt).getTime() <= Date.now();
  const canEmail = ended && /^https?:\/\//i.test(savedReplay) && selected.size > 0;

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={session.title} subtitle={session.dateLabel} />
        <div className="space-y-4 p-5">
          {!session.attendanceTracked && (
            <p className="text-sm text-ink-soft">
              This session was held on an external link, so who came can’t be seen here. You can still email
              the replay to everyone who RSVP’d.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Replay link"
              hint={
                session.source === "event"
                  ? "Shared by every session of this webinar"
                  : session.recurring
                    ? "For this session only"
                    : undefined
              }
              className="min-w-[16rem] flex-1"
            >
              <Input
                placeholder="https://…"
                value={replayUrl}
                onChange={(event) => setReplayUrl(event.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || replayUrl.trim() === savedReplay}
              onClick={() => void saveReplay()}
            >
              {saving ? "Saving…" : "Save link"}
            </Button>
          </div>
          {session.source === "community" && (
            <Field label="Who was it for?">
              <select
                className={selectStyles}
                value={audience}
                onChange={(event) => setAudience(event.target.value as "registered" | "members")}
              >
                <option value="registered">People who RSVP’d</option>
                <option value="members">Everyone in the community{session.recurring ? " (or its group)" : ""}</option>
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={includeAttendees}
              onChange={(event) => setIncludeAttendees(event.target.checked)}
            />
            Tick the people who came as well
          </label>
        </div>
      </Card>

      {error && <ErrorNotice message={error} />}

      <Card>
        <CardHeader
          title="People"
          subtitle={
            people
              ? `${people.filter((person) => person.attended === true).length} came · ${
                  people.filter((person) => person.invited && person.attended === false).length
                } missed it`
              : undefined
          }
          action={
            <Button
              size="sm"
              disabled={!canEmail}
              title={
                !ended
                  ? "This session has not finished yet"
                  : !/^https?:\/\//i.test(savedReplay)
                    ? "Save the replay link first"
                    : selected.size === 0
                      ? "Tick who to email"
                      : undefined
              }
              onClick={() => setComposing(true)}
            >
              <Mail />
              Email the replay ({selected.size})
            </Button>
          }
        />
        {people === null ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : people.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="Nobody on the list"
            description={
              audience === "registered" && session.source === "community"
                ? "Nobody RSVP’d. Switch “Who was it for?” to everyone in the community."
                : "Nobody registered for this session."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-hairline/60 text-left text-xs uppercase tracking-[0.08em] text-ink-soft">
                  <th className="w-10 px-5 py-3" />
                  <th className="px-3 py-3 font-semibold">Person</th>
                  <th className="px-3 py-3 font-semibold">Invited</th>
                  <th className="px-3 py-3 font-semibold">Came?</th>
                  <th className="px-3 py-3 font-semibold">Replay sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/50">
                {people.map((person) => {
                  const key = personKey(person);
                  return (
                    <tr key={key}>
                      <td className="px-5 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Tick ${person.name || person.email}`}
                          checked={selected.has(key)}
                          onChange={() => toggle(key)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-ink">{person.name || person.email}</div>
                        <div className="text-xs text-ink-soft [overflow-wrap:anywhere]">{person.email}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-soft">{INVITED_AS_LABEL[person.invitedAs]}</td>
                      <td className="px-3 py-3">
                        {person.attended === null ? (
                          <Badge>Unknown</Badge>
                        ) : person.attended ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge tone="green">Came</Badge>
                            {person.minutesAttended > 0 && (
                              <span className={`text-xs ${NUMBER}`}>{describeMinutes(person.minutesAttended)}</span>
                            )}
                          </span>
                        ) : (
                          <Badge tone="gold">Missed it</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-soft">
                        {person.replaySentAt ? formatDateTime(person.replaySentAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {defaults && (
        <ComposeModal
          open={composing}
          onOpenChange={setComposing}
          title={`Email the replay to ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
          description={`“${session.title}”, ${session.dateLabel}.`}
          defaults={defaults}
          tokens={REPLAY_TOKENS}
          submitLabel="Send"
          onSubmit={async (copy) => {
            const result = await engagementApi.sendReplay({
              key: session.key,
              audience,
              people: [...selected],
              ...copy,
            });
            toast.success(describeSendResult(result));
            onSent();
            void load();
          }}
        />
      )}
    </div>
  );
}

/* =============================================================== compose */

function ComposeModal({
  open,
  onOpenChange,
  title,
  description,
  defaults,
  tokens,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  defaults: EmailCopy;
  tokens: string;
  submitLabel: string;
  onSubmit: (copy: EmailCopy) => Promise<void>;
}) {
  const [subject, setSubject] = useState(defaults.subject);
  const [bodyMd, setBodyMd] = useState(defaults.bodyMd);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!subject.trim() || !bodyMd.trim()) {
      setError("The email needs a subject and something to say.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await onSubmit({ subject: subject.trim(), bodyMd: bodyMd.trim() });
      onOpenChange(false);
    } catch (err) {
      setError(friendlyError(err, "email"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={sending}>
            <Mail />
            {sending ? "Sending…" : submitLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNotice message={error} />}
        <Field label="Subject">
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field label="What the email says" hint={`You can use ${tokens}`}>
          <Textarea rows={10} value={bodyMd} onChange={(event) => setBodyMd(event.target.value)} />
        </Field>
        <p className="text-xs text-ink-soft">
          Anyone who has unsubscribed, or turned these emails off in their account, is skipped. Each person
          gets at most one of these a day, so pressing twice sends once.
        </p>
      </div>
    </Modal>
  );
}

/* ================================================================== log */

const SEND_STATUS_TONE: Record<EngagementSendRow["status"], "neutral" | "green" | "gold" | "red" | "blue"> = {
  queued: "blue",
  sending: "blue",
  sent: "green",
  suppressed: "gold",
  failed: "red",
};

const SEND_STATUS_LABEL: Record<EngagementSendRow["status"], string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  suppressed: "Skipped",
  failed: "Failed",
};

function RecentSends({ version }: { version: number }) {
  const [rows, setRows] = useState<EngagementSendRow[] | null>(null);

  useEffect(() => {
    engagementApi
      .sends(30)
      .then(setRows)
      .catch(() => setRows([]));
  }, [version]);

  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Recently sent from this page" subtitle="Reminders and replays, newest first." />
      <ul className="divide-y divide-hairline/60">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-ink">
                {row.kind === "replay" ? "Replay" : "Reminder"}: {row.about || row.subject}
              </span>
              <span className="block truncate text-xs text-ink-soft">
                {row.email} · {formatDateTime(row.createdAt)}
                {row.error && row.status !== "sent" ? ` · ${row.error}` : ""}
              </span>
            </span>
            <Badge tone={SEND_STATUS_TONE[row.status]}>{SEND_STATUS_LABEL[row.status]}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

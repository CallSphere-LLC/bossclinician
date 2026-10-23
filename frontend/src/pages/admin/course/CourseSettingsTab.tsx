import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CalendarPlus, ExternalLink, Film, Radio, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { adminCommerceApi, commerceMessage } from "@/lib/adminCommerceApi";
import { formatDateTime } from "@/lib/format";
import type { Course } from "@/types";
import {
  Badge,
  Button,
  Card,
  ErrorNotice,
  Field,
  Input,
  Skeleton,
  selectStyles,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { PUBLISH_LABEL, friendlyError, fromDateTimeInput } from "@/pages/admin/ui/friendly";
import {
  courseHubApi,
  type CourseLiveSession,
  type CourseSettings,
  type CourseSettingsOffer,
} from "./courseHubApi";
import { LIVE_SECTION_TITLE, replayLessonTitle } from "./courseHub";

/**
 * Kajabi's course "Settings" tab: whether the course is on the website, the
 * community it belongs to, the paywall between the two, and the live room.
 *
 * Paywall, both ways, is offers holding products: "course behind the
 * community's paywall" puts this course into the offers that sell the
 * community, and "buyers join the community" puts the community into this
 * course's offers. Both use the offer router's own attach and detach, so the
 * offer editor shows exactly what was done here.
 *
 * A live session is a community event in that community's live room plus a
 * draft lesson waiting for the replay. Nothing records the room, so she adds the
 * recording to that lesson afterwards and publishes it — the copy says so.
 */
export function CourseSettingsTab({
  courseId,
  course,
  sections,
  onCourseChanged,
  onOutlineChanged,
  onEditLesson,
}: {
  courseId: number;
  course: Course | null;
  /** The outline's sections, for where a replay lesson goes. */
  sections: { id: number; title: string }[];
  onCourseChanged: () => void;
  onOutlineChanged: () => void;
  /** Opens the lesson editor on the replay lesson. */
  onEditLesson: (lessonId: number) => void;
}) {
  const [settings, setSettings] = useState<CourseSettings | null>(null);
  const [sessions, setSessions] = useState<CourseLiveSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [communityChoice, setCommunityChoice] = useState("");
  const [savingCommunity, setSavingCommunity] = useState(false);
  const [togglingOffer, setTogglingOffer] = useState<number | null>(null);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    courseHubApi
      .settings(courseId)
      .then((next) => {
        setSettings(next);
        setCommunityChoice(next.communityId ? String(next.communityId) : "");
        setError(null);
      })
      .catch(() => setError("We couldn't load this course's settings. Try refreshing the page."));
    courseHubApi
      .liveSessions(courseId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [courseId]);

  useEffect(load, [load]);

  async function saveVisibility(published: boolean) {
    setSavingVisibility(true);
    try {
      await adminApi.courseUpdate(String(courseId), { published });
      toast.success(published ? "The course is live on your site" : "The course is hidden from your site");
      onCourseChanged();
      load();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    } finally {
      setSavingVisibility(false);
    }
  }

  async function saveCommunity(e: FormEvent) {
    e.preventDefault();
    setSavingCommunity(true);
    try {
      await courseHubApi.settingsSave(courseId, { communityId: communityChoice ? Number(communityChoice) : null });
      toast.success(communityChoice ? "Community linked" : "Community unlinked");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "community"));
    } finally {
      setSavingCommunity(false);
    }
  }

  /** Course into (or out of) an offer that sells the community. */
  async function toggleCourseInCommunityOffer(offer: CourseSettingsOffer) {
    setTogglingOffer(offer.id);
    try {
      if (offer.courseProductId) {
        await adminCommerceApi.offerProductRemove(offer.id, offer.courseProductId);
        toast.success(`“${offer.title}” no longer includes this course`);
      } else {
        const product = settings?.courseProductId ?? (await courseHubApi.ensureProduct(courseId)).id;
        await adminCommerceApi.offerProductAdd(offer.id, product, 99);
        toast.success(`Members who buy “${offer.title}” now get this course`);
      }
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    } finally {
      setTogglingOffer(null);
    }
  }

  /** Community into (or out of) an offer that sells this course. */
  async function toggleCommunityInCourseOffer(offer: CourseSettingsOffer, communityProductId: number | null) {
    setTogglingOffer(offer.id);
    try {
      if (offer.communityProductId) {
        await adminCommerceApi.offerProductRemove(offer.id, offer.communityProductId);
        toast.success(`“${offer.title}” no longer includes the community`);
      } else if (communityProductId) {
        await adminCommerceApi.offerProductAdd(offer.id, communityProductId, 99);
        toast.success(`Buyers of “${offer.title}” now join the community too`);
      }
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    } finally {
      setTogglingOffer(null);
    }
  }

  if (error) return <ErrorNotice message={error} />;
  if (!settings) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  const community = settings.community;
  // The membership product the course's buyers would be given: the community
  // product itself when there is one, otherwise its first tier.
  const membership =
    community?.products.find((product) => product.kind === "community" && product.status !== "archived") ??
    community?.products.find((product) => product.status !== "archived") ??
    null;
  const choosable = settings.communities.filter(
    (option) => !option.archived || option.id === settings.communityId,
  );
  const buyersLockedOut =
    community !== null &&
    community.sold &&
    settings.courseOffers.some((offer) => offer.status === "published" && !offer.communityProductId);
  const published = course?.published ?? settings.published;

  return (
    <div className="space-y-5">
      {/* Visibility */}
      <Card className="space-y-3 p-5">
        <SectionTitle title="On your website" />
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={published}
            disabled={savingVisibility}
            onChange={(e) => void saveVisibility(e.target.checked)}
            className="size-4 rounded border-hairline text-plum"
          />
          {PUBLISH_LABEL.live}
        </label>
        <p className="text-xs text-ink-soft">
          {published
            ? "Anyone can see this course on your site. Only people with access can open its lessons."
            : "Nobody can see this course on your site yet. People you give access to can still open it."}{" "}
          Price, description and cover image are under <span className="font-semibold">Edit</span> on the Courses page.
        </p>
      </Card>

      {/* Community */}
      <Card className="space-y-4 p-5">
        <SectionTitle
          title="Community"
          description="Link the community this course belongs to. Live sessions for the course are held in its live room."
        />
        <form onSubmit={saveCommunity} className="flex flex-wrap items-end gap-2">
          <Field label="Linked community" className="min-w-0 flex-1 basis-64">
            <select
              className={selectStyles}
              value={communityChoice}
              onChange={(e) => setCommunityChoice(e.target.value)}
              aria-label="Community this course belongs to"
            >
              <option value="">No community</option>
              {choosable.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.archived ? " (archived)" : !option.published ? " (not published)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Button
            size="sm"
            type="submit"
            disabled={savingCommunity || communityChoice === (settings.communityId ? String(settings.communityId) : "")}
          >
            {savingCommunity ? "Saving…" : "Save"}
          </Button>
          {community && (
            <Button asChild variant="secondary" size="sm">
              <Link to={`/admin/community/${community.id}`}>
                <ExternalLink />
                Open community
              </Link>
            </Button>
          )}
        </form>

        {community && (
          <>
            <div className="space-y-2 border-t border-hairline/60 pt-4">
              <p className="text-sm font-semibold text-ink">Put this course behind the community's paywall</p>
              {!community.sold ? (
                <p className="text-sm text-ink-soft">
                  {community.name} is free to join, so there is no paywall to put the course behind. Sell the
                  course with its own offers instead.
                </p>
              ) : settings.communityOffers.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  No offer sells {community.name} yet. Once one does, you can include this course with it here.
                </p>
              ) : (
                <>
                  <p className="text-xs text-ink-soft">
                    Members who buy a ticked offer get this course with their membership.
                  </p>
                  <OfferToggleList
                    offers={settings.communityOffers}
                    isOn={(offer) => Boolean(offer.courseProductId)}
                    busyId={togglingOffer}
                    onToggle={(offer) => void toggleCourseInCommunityOffer(offer)}
                  />
                </>
              )}
            </div>

            <div className="space-y-2 border-t border-hairline/60 pt-4">
              <p className="text-sm font-semibold text-ink">Course buyers also join {community.name}</p>
              {!community.sold ? (
                <p className="text-sm text-ink-soft">
                  {community.name} is free, so anyone signed in can already join — nothing to add.
                </p>
              ) : settings.courseOffers.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  This course isn't in any offer yet. Add one on the{" "}
                  <Link to={`/admin/courses/${courseId}/curriculum?tab=offers`} className="font-semibold text-plum hover:underline">
                    Offers tab
                  </Link>
                  .
                </p>
              ) : !membership ? (
                <p className="text-sm text-ink-soft">
                  {community.name} has no membership product to give, so it can't be added to an offer from here.
                </p>
              ) : (
                <>
                  <p className="text-xs text-ink-soft">
                    Buyers of a ticked offer are given “{membership.title}” as well.
                  </p>
                  <OfferToggleList
                    offers={settings.courseOffers}
                    isOn={(offer) => Boolean(offer.communityProductId)}
                    busyId={togglingOffer}
                    onToggle={(offer) => void toggleCommunityInCourseOffer(offer, membership.id)}
                  />
                </>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Live room */}
      <LiveSessionsCard
        courseId={courseId}
        courseTitle={course?.title ?? ""}
        community={community}
        sessions={sessions}
        sections={sections}
        buyersLockedOut={buyersLockedOut}
        confirm={confirm}
        onChanged={() => {
          load();
          onOutlineChanged();
        }}
        onEditLesson={onEditLesson}
      />

      {confirmDialog}
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="font-display text-lg text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
    </div>
  );
}

function OfferToggleList({
  offers,
  isOn,
  busyId,
  onToggle,
}: {
  offers: CourseSettingsOffer[];
  isOn: (offer: CourseSettingsOffer) => boolean;
  busyId: number | null;
  onToggle: (offer: CourseSettingsOffer) => void;
}) {
  return (
    <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline">
      {offers.map((offer) => (
        <li key={offer.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={isOn(offer)}
              disabled={busyId !== null}
              onChange={() => onToggle(offer)}
              className="size-4 shrink-0 rounded border-hairline text-plum"
            />
            <span className="truncate">{offer.internalTitle || offer.title}</span>
          </label>
          {busyId === offer.id && <span className="text-xs text-ink-soft">Saving…</span>}
          <Badge tone={offer.status === "published" ? "green" : "slate"}>
            {offer.status === "published" ? "Live" : offer.status === "archived" ? "Archived" : "Draft"}
          </Badge>
          <Link to={`/admin/offers/${offer.id}`} className="text-xs font-semibold text-plum hover:underline">
            Edit
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------- Live room */

const NEW_SECTION = "new";

function LiveSessionsCard({
  courseId,
  courseTitle,
  community,
  sessions,
  sections,
  buyersLockedOut,
  confirm,
  onChanged,
  onEditLesson,
}: {
  courseId: number;
  courseTitle: string;
  community: CourseSettings["community"];
  sessions: CourseLiveSession[] | null;
  sections: { id: number; title: string }[];
  buyersLockedOut: boolean;
  confirm: ReturnType<typeof useConfirm>[0];
  onChanged: () => void;
  onEditLesson: (lessonId: number) => void;
}) {
  const existingLiveSection = sections.find((section) => section.title.trim() === LIVE_SECTION_TITLE);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [form, setForm] = useState({
    title: "",
    startsAt: "",
    durationMinutes: "60",
    sectionId: "",
    makeLesson: true,
  });

  function startSchedule() {
    setForm({
      title: courseTitle ? `${courseTitle} — live session` : "Live session",
      startsAt: "",
      durationMinutes: "60",
      sectionId: existingLiveSection ? String(existingLiveSection.id) : NEW_SECTION,
      makeLesson: true,
    });
    setScheduling(true);
  }

  /*
   * "Join the live room as host", as on the community page: the room only lets
   * member sessions in, so the server hands back a one-time sign-in link. The
   * tab is opened inside the click, before the request — a popup blocker only
   * trusts a window.open made by the click itself.
   */
  async function joinAsHost() {
    if (!community) return;
    const tab = window.open("", "_blank");
    if (!tab) {
      toast.error("Your browser blocked the new tab. Allow pop-ups for the admin and press Join again.");
      return;
    }
    tab.opener = null;
    setJoining(true);
    try {
      const { url } = await adminApi.communityLiveHostLink(community.id);
      tab.location.href = url;
    } catch (err) {
      tab.close();
      toast.error(friendlyError(err, "community"));
    } finally {
      setJoining(false);
    }
  }

  async function schedule(e: FormEvent) {
    e.preventDefault();
    if (!community || busy) return;
    const title = form.title.trim();
    const startsAt = fromDateTimeInput(form.startsAt);
    if (!title) return;
    if (!startsAt) {
      toast.error("Choose the date and time of the session.");
      return;
    }
    const duration = Math.max(5, Math.min(600, Number(form.durationMinutes) || 60));
    setBusy(true);
    try {
      // 1. The session itself, on the community calendar, in its own live room.
      const event = await adminApi.eventCreate(community.id, {
        title,
        description: courseTitle ? `A live session for the course “${courseTitle}”.` : "",
        startsAt,
        durationMinutes: duration,
        joinMode: "native",
        locationUrl: "",
        recurrenceFreq: null,
        recurrenceInterval: 1,
        recurrenceUntil: null,
        recurrenceCount: null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        accessGroupId: null,
      });

      // 2. The lesson the replay goes into, kept as a draft until it has one.
      let lessonId: number | null = null;
      if (form.makeLesson) {
        try {
          let sectionId = Number(form.sectionId);
          if (form.sectionId === NEW_SECTION || !sectionId) {
            const created = await adminApi.moduleCreate(courseId, { title: LIVE_SECTION_TITLE });
            sectionId = Number(created.id);
          }
          const when = formatDateTime(startsAt);
          const lesson = await adminApi.lessonCreate(sectionId, {
            title: replayLessonTitle(title),
            contentType: "video",
            published: false,
            bodyMd: `The recording of our live session on ${when}.`,
            durationMinutes: 0,
          });
          lessonId = Number(lesson.id);
        } catch (err) {
          toast.error(`The session is scheduled, but the replay lesson wasn't made: ${friendlyError(err, "lesson")}`);
        }
      }

      // 3. That the two belong to this course.
      await courseHubApi.liveSessionAdd(courseId, { communityEventId: Number(event.id), lessonId });
      toast.success(
        lessonId
          ? "Session scheduled. Its replay lesson is waiting in the outline as a draft."
          : "Session scheduled on the community calendar.",
      );
      setScheduling(false);
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "live session"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession(session: CourseLiveSession) {
    const upcoming = session.startsAt ? new Date(session.startsAt).getTime() > Date.now() : false;
    const ok = await confirm({
      title: `Remove “${session.title}”?`,
      description: upcoming
        ? "It comes off the community calendar. The replay lesson stays in your outline — delete it there if you don't need it."
        : "It comes off this list and the community calendar. The replay lesson stays in your outline.",
      confirmLabel: "Yes, remove it",
      destructive: true,
    });
    if (!ok) return;
    try {
      if (session.communityEventId && session.eventExists) await adminApi.eventDelete(session.communityEventId);
      await courseHubApi.liveSessionRemove(courseId, session.id);
      toast.success("Live session removed");
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "live session"));
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          title="Live room"
          description="Host live sessions for this course. Each one gets a replay lesson in the outline: add the recording after the session and publish it."
        />
        {community && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void joinAsHost()} disabled={joining}>
              <Radio />
              {joining ? "Opening…" : "Join the live room as host"}
            </Button>
            <Button size="sm" onClick={startSchedule}>
              <CalendarPlus />
              Schedule a live session
            </Button>
          </div>
        )}
      </div>

      {!community ? (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-soft">
          <Users aria-hidden className="mr-1.5 inline size-4 align-[-3px]" />
          Link a community above first — live sessions are held in its live room, and show on its calendar.
        </p>
      ) : (
        <>
          {buyersLockedOut && (
            <p className="rounded-xl border border-gold/35 bg-gold/[0.08] px-4 py-3 text-sm text-ink">
              Some people who bought only this course can't get into {community.name}, so they won't see its live
              sessions. Tick “Course buyers also join {community.name}” above to let them in.
            </p>
          )}
          {sessions === null ? (
            <Skeleton className="h-16 w-full" />
          ) : sessions.length === 0 ? (
            <p className="text-sm text-ink-soft">No live sessions for this course yet.</p>
          ) : (
            <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                  <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">
                    <p className="truncate text-sm font-medium text-ink">{session.title}</p>
                    <p className="text-xs text-ink-soft">
                      <span className="tabular-nums">{session.startsAt ? formatDateTime(session.startsAt) : "No date"}</span>
                      {session.durationMinutes ? (
                        <>
                          {" · "}
                          <span className="tabular-nums">{session.durationMinutes}</span> min
                        </>
                      ) : null}
                      {session.communityName ? ` · ${session.communityName}` : ""}
                      {!session.eventExists ? " · no longer on the calendar" : ""}
                    </p>
                  </div>
                  {session.lessonId === null ? (
                    <Badge tone="slate">No replay lesson</Badge>
                  ) : session.lessonPublished && session.lessonHasRecording ? (
                    <Badge tone="green">Replay published</Badge>
                  ) : session.lessonHasRecording ? (
                    <Badge tone="gold">Replay added, not published</Badge>
                  ) : (
                    <Badge tone="slate">Waiting for the recording</Badge>
                  )}
                  {session.lessonId !== null && (
                    <Button variant="secondary" size="sm" onClick={() => onEditLesson(Number(session.lessonId))}>
                      <Film />
                      {session.lessonHasRecording ? "Edit replay lesson" : "Add the recording"}
                    </Button>
                  )}
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Remove ${session.title}`}
                    onClick={() => void cancelSession(session)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal
        open={scheduling}
        onOpenChange={setScheduling}
        title="Schedule a live session"
        description={community ? `Held in ${community.name}'s live room, and added to its calendar.` : undefined}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setScheduling(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="schedule-live" disabled={busy}>
              {busy ? "Scheduling…" : "Schedule session"}
            </Button>
          </>
        }
      >
        <form id="schedule-live" onSubmit={schedule} className="space-y-4">
          <Field label="Session name">
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date and time" hint="in your time zone">
              <Input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                required
              />
            </Field>
            <Field label="Length" hint="minutes">
              <Input
                type="number"
                min={5}
                max={600}
                step={5}
                className="tabular-nums"
                value={form.durationMinutes}
                onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.makeLesson}
              onChange={(e) => setForm((f) => ({ ...f, makeLesson: e.target.checked }))}
              className="size-4 rounded border-hairline text-plum"
            />
            Make a replay lesson for it
          </label>
          {form.makeLesson && (
            <Field
              label="Put the replay lesson in"
              hint="it starts as a draft, so students only see it once you add the recording and publish"
            >
              <select
                className={selectStyles}
                value={form.sectionId}
                onChange={(e) => setForm((f) => ({ ...f, sectionId: e.target.value }))}
                aria-label="Section for the replay lesson"
              >
                {!existingLiveSection && <option value={NEW_SECTION}>A new section: “{LIVE_SECTION_TITLE}”</option>}
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="text-xs text-ink-soft">
            The live room isn't recorded automatically. Record the session (for example with your screen recorder or
            Zoom), then open the replay lesson and add the video.
          </p>
        </form>
      </Modal>
    </Card>
  );
}

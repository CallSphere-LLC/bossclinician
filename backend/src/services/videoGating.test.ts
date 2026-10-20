import { describe, expect, it } from "vitest";
import {
  advancePlayedTo,
  buildModules,
  flattenLessons,
  formatRemaining,
  fullWatchRequiredSeconds,
  isFullyWatched,
} from "./curriculum";
import {
  certificateGaps,
  summarizeCertificateStatus,
  type CertificateFacts,
  type CertificateLessonRow,
} from "./certificates";

/**
 * Sheet rows 122/124: "make them watch the entire video before moving on", and
 * the CE certificate only after the post-test and the evaluation.
 */

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("advancePlayedTo — the furthest point played through", () => {
  it("credits contiguous playback reported by the player", () => {
    expect(
      advancePlayedTo({ claimedSeconds: 110, storedSeconds: 100, lastViewedAt: ago(10), now: NOW, durationSeconds: 4492 })
    ).toBe(110);
  });

  it("does not count a seek ahead: a jump to the end is clamped to real time", () => {
    // Ten seconds since the last report, at most 2.5x playback plus slack.
    const credited = advancePlayedTo({
      claimedSeconds: 4400,
      storedSeconds: 100,
      lastViewedAt: ago(10),
      now: NOW,
      durationSeconds: 4492,
    });
    expect(credited).toBeLessThanOrEqual(100 + 10 * 2.5);
    expect(isFullyWatched(credited, 4492)).toBe(false);
  });

  it("a burst of reports cannot walk it forward faster than the clock", () => {
    let stored = 0;
    let last: Date | null = null;
    // Fifty reports in the same instant, each claiming the end.
    for (let i = 0; i < 50; i += 1) {
      stored = advancePlayedTo({ claimedSeconds: 4492, storedSeconds: stored, lastViewedAt: last, now: NOW, durationSeconds: 4492 });
      last = NOW;
    }
    expect(stored).toBeLessThan(100);
  });

  it("never goes backwards when the member re-watches an earlier part", () => {
    expect(
      advancePlayedTo({ claimedSeconds: 30, storedSeconds: 900, lastViewedAt: ago(10), now: NOW, durationSeconds: 4492 })
    ).toBe(900);
  });

  it("never runs past the media's length", () => {
    expect(
      advancePlayedTo({ claimedSeconds: 5000, storedSeconds: 4480, lastViewedAt: ago(10), now: NOW, durationSeconds: 4492 })
    ).toBe(4492);
  });
});

describe("the 95% full-watch rule", () => {
  it("needs 95% of the recorded length", () => {
    expect(fullWatchRequiredSeconds(4492)).toBe(4268);
    expect(isFullyWatched(4267, 4492)).toBe(false);
    expect(isFullyWatched(4268, 4492)).toBe(true);
  });

  it("cannot be satisfied against an unknown length", () => {
    expect(fullWatchRequiredSeconds(0)).toBe(0);
    expect(isFullyWatched(10_000, 0)).toBe(false);
  });

  it("formats what is left", () => {
    expect(formatRemaining(760)).toBe("12:40");
    expect(formatRemaining(3725)).toBe("1:02:05");
  });
});

describe("buildModules with \"Require watching the full video\"", () => {
  const settings = { releaseMinute: 6 * 60, timezone: "America/New_York" };
  const granted = new Date("2026-10-01T12:00:00Z");

  function row(id: number, extra: Record<string, unknown> = {}) {
    return {
      course_id: 1, module_id: 1, module_title: "ZZ Module", module_summary: "",
      module_drip_days: null, module_drip_date: null,
      lesson_id: id, slug: `zz-${id}`, title: `ZZ Lesson ${id}`, content_type: "text",
      duration_minutes: 5, video_duration_seconds: 0, preview: false,
      lesson_drip_days: null, lesson_drip_date: null, comments_enabled: true,
      lesson_published: true, requires_previous_lesson: false, lesson_publish_at: null,
      assessment_requires_pass: false, assessment_passed: false, notes_enabled: true,
      last_position_seconds: null, watched_percent: null, completed_at: null, last_viewed_at: null,
      require_full_video: true, has_media: false, max_position_seconds: null,
      ...extra,
    } as Parameters<typeof buildModules>[0][number];
  }
  const lessons = (rows: Parameters<typeof buildModules>[0]) =>
    flattenLessons(buildModules(rows, granted, NOW, settings));
  const video = (extra: Record<string, unknown> = {}) =>
    row(1, { content_type: "video", has_media: true, video_duration_seconds: 1000, ...extra });

  it("locks the next lesson behind an unwatched video even without \"Lock\", with the time left", () => {
    const [first, second] = lessons([video({ max_position_seconds: 190 }), row(2)]);
    expect(first.fullWatch).toEqual({ required: true, playedToSeconds: 190, requiredSeconds: 950, durationSeconds: 1000 });
    expect(second).toMatchObject({ unlocked: false, lockReason: "previous_incomplete" });
    expect(second.unlockLabel).toBe("Finish watching “ZZ Lesson 1” to unlock — 12:40 left");
  });

  it("opens the next lesson once the video completed", () => {
    const [, second] = lessons([video({ max_position_seconds: 960, completed_at: NOW }), row(2)]);
    expect(second.unlocked).toBe(true);
  });

  it("leaves other courses alone", () => {
    const [first, second] = lessons([video({ require_full_video: false }), row(2, { require_full_video: false })]);
    expect(first.fullWatch.required).toBe(false);
    expect(second.unlocked).toBe(true);
  });
});

/* ------------------------------------------------------------- certificate */

function lesson(overrides: Partial<CertificateLessonRow> = {}): CertificateLessonRow {
  return {
    title: "ZZ Lesson",
    completed: true,
    hasMedia: false,
    videoDurationSeconds: 0,
    playedToSeconds: 0,
    watchedPercent: 0,
    hasSurvey: false,
    surveySubmitted: false,
    ...overrides,
  };
}

describe("certificateGaps", () => {
  const trainingVideo = (playedTo: number, completed = true) =>
    lesson({ title: "Watch the training", hasMedia: true, videoDurationSeconds: 4492, playedToSeconds: playedTo, completed });

  it("names a video that was ticked but not watched through, when the course requires it", () => {
    const gaps = certificateGaps([trainingVideo(1000)], { requireFullVideo: true });
    expect(gaps.videosToFinish).toEqual([{ lessonTitle: "Watch the training", remainingSeconds: 4268 - 1000 }]);
    expect(certificateGaps([trainingVideo(1000)], { requireFullVideo: false }).videosToFinish).toEqual([]);
  });

  it("names the evaluation until it is submitted", () => {
    const evaluation = lesson({ title: "Course Evaluation", completed: false, hasSurvey: true });
    const gaps = certificateGaps([trainingVideo(4300), evaluation], { requireFullVideo: true });
    expect(gaps).toMatchObject({
      evaluationsToSubmit: ["Course Evaluation"],
      videosToFinish: [],
      otherLessonsRemaining: 0,
      lessonsRemaining: 1,
    });
    const done = certificateGaps(
      [trainingVideo(4300), { ...evaluation, completed: true, surveySubmitted: true }],
      { requireFullVideo: true }
    );
    expect(done).toMatchObject({ evaluationsToSubmit: [], lessonsRemaining: 0 });
  });

  it("does not accept a completion tick in place of submitting a native evaluation", () => {
    const evaluation = lesson({
      title: "Program Evaluation",
      completed: true,
      hasSurvey: true,
      surveySubmitted: false,
    });
    const gaps = certificateGaps([trainingVideo(4300), evaluation], { requireFullVideo: true });
    expect(gaps.evaluationsToSubmit).toEqual(["Program Evaluation"]);
    expect(summarizeCertificateStatus(facts({
      totalLessons: gaps.totalLessons,
      lessonsRemaining: gaps.lessonsRemaining,
      otherLessonsRemaining: gaps.otherLessonsRemaining,
      evaluationsToSubmit: gaps.evaluationsToSubmit,
    })).eligible).toBe(false);
  });

  it("falls back to the 90% watch figure for a video with no recorded length", () => {
    const unmeasured = lesson({ hasMedia: true, watchedPercent: 89 });
    expect(certificateGaps([unmeasured], { requireFullVideo: true }).videosToFinish).toHaveLength(1);
    expect(certificateGaps([{ ...unmeasured, watchedPercent: 90 }], { requireFullVideo: true }).videosToFinish).toHaveLength(0);
  });
});

function facts(overrides: Partial<CertificateFacts> = {}): CertificateFacts {
  return {
    issued: false,
    hasTemplate: true,
    requiresPassingQuizzes: true,
    totalLessons: 4,
    lessonsRemaining: 0,
    quizzesToPass: [],
    ceuPending: false,
    ...overrides,
  };
}

describe("summarizeCertificateStatus — evaluation and Educational Access", () => {
  it("missing evaluation: not issued, and says so in one sentence", () => {
    const status = summarizeCertificateStatus(
      facts({ lessonsRemaining: 1, otherLessonsRemaining: 0, evaluationsToSubmit: ["Course Evaluation"] })
    );
    expect(status.eligible).toBe(false);
    expect(status.message).toBe("Complete the course evaluation to receive your certificate.");
  });

  it("all done: eligible", () => {
    const status = summarizeCertificateStatus(
      facts({ otherLessonsRemaining: 0, evaluationsToSubmit: [], videosToFinish: [] })
    );
    expect(status.eligible).toBe(true);
  });

  it("lists every missing step in order", () => {
    const status = summarizeCertificateStatus(
      facts({
        lessonsRemaining: 3,
        otherLessonsRemaining: 0,
        videosToFinish: [{ lessonTitle: "Watch the training", remainingSeconds: 760 }],
        quizzesToPass: [{ lessonTitle: "Post-Test", assessmentTitle: "Post-Test", passMark: 75 }],
        evaluationsToSubmit: ["Course Evaluation"],
      })
    );
    expect(status.eligible).toBe(false);
    expect(status.message).toBe(
      "Finish watching “Watch the training” (12:40 left), pass the quiz in “Post-Test” (pass mark 75%) and complete the course evaluation to get your certificate."
    );
  });

  it("Educational Access (no CE credit) is never eligible and is told why", () => {
    const status = summarizeCertificateStatus(facts({ excludedByPurchase: true }));
    expect(status).toMatchObject({ eligible: false, offered: false, excludedByPurchase: true });
    expect(status.message).toMatch(/doesn't include the CE certificate/);
  });

  it("an already issued certificate stays issued whatever the option", () => {
    const status = summarizeCertificateStatus(facts({ issued: true, excludedByPurchase: true }));
    expect(status).toMatchObject({ issued: true, offered: true, excludedByPurchase: false });
  });
});

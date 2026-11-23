import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterClosePath,
  cleanCountdownSlug,
  clockOffsetMs,
  pad2,
  remainingParts,
  spokenRemaining,
  splitCountdownBlocks,
  startCountdown,
  timedOffer,
  type CountdownParts,
  type CourseOfferDeadlineInfo,
} from "@/lib/countdown";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-12-01T20:00:00.000Z");

describe("remainingParts", () => {
  it("splits the time left into days, hours, minutes and seconds", () => {
    const left = 2 * DAY + 3 * HOUR + 4 * MINUTE + 5 * SECOND;
    expect(remainingParts(T0 + left, T0)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5, done: false });
  });

  it("rounds a part second up, so the last second still reads 1", () => {
    expect(remainingParts(T0 + 1, T0)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1, done: false });
    expect(remainingParts(T0 + 59_001, T0)).toMatchObject({ minutes: 1, seconds: 0 });
  });

  it("is done, with every figure at zero, exactly at the deadline and after it", () => {
    const zero = { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
    expect(remainingParts(T0, T0)).toEqual(zero);
    expect(remainingParts(T0, T0 + 5 * DAY)).toEqual(zero);
  });

  it("does not cap the days at 99", () => {
    const parts = remainingParts(T0 + 120 * DAY + 2 * HOUR, T0);
    expect(parts.days).toBe(120);
    expect(parts.hours).toBe(2);
    expect(pad2(parts.days)).toBe("120");
  });

  it("treats an unreadable deadline as over rather than showing nonsense", () => {
    expect(remainingParts(Number.NaN, T0).done).toBe(true);
  });
});

describe("clockOffsetMs", () => {
  it("is how far the server is ahead of this device", () => {
    expect(clockOffsetMs("2026-12-01T20:00:00.000Z", T0 - HOUR)).toBe(HOUR);
    expect(clockOffsetMs("2026-12-01T20:00:00.000Z", T0 + 90 * SECOND)).toBe(-90 * SECOND);
  });

  it("falls back to the device clock when the server time is missing or unreadable", () => {
    expect(clockOffsetMs(null, T0)).toBe(0);
    expect(clockOffsetMs("not a date", T0)).toBe(0);
  });

  it("gives the true time left on a device whose clock is an hour slow", () => {
    const deviceNow = T0 - HOUR;
    const offset = clockOffsetMs(new Date(T0).toISOString(), deviceNow);
    expect(remainingParts(T0 + 10 * MINUTE, deviceNow + offset)).toMatchObject({ hours: 0, minutes: 10, seconds: 0 });
    // The uncorrected device clock would have promised an extra hour.
    expect(remainingParts(T0 + 10 * MINUTE, deviceNow)).toMatchObject({ hours: 1, minutes: 10 });
  });
});

describe("spokenRemaining", () => {
  const parts = (over: Partial<CountdownParts>): CountdownParts => ({
    days: 0, hours: 0, minutes: 0, seconds: 0, done: false, ...over,
  });

  it("reads the time left as a sentence without the seconds", () => {
    expect(spokenRemaining(parts({ days: 2, hours: 1, minutes: 5, seconds: 42 }))).toBe("2 days, 1 hour and 5 minutes left.");
    expect(spokenRemaining(parts({ hours: 3, seconds: 9 }))).toBe("3 hours left.");
    expect(spokenRemaining(parts({ days: 1, minutes: 1 }))).toBe("1 day and 1 minute left.");
  });

  it("does not change from one second to the next", () => {
    expect(spokenRemaining(parts({ minutes: 4, seconds: 59 }))).toBe(spokenRemaining(parts({ minutes: 4, seconds: 1 })));
  });

  it("covers the last minute and the end", () => {
    expect(spokenRemaining(parts({ seconds: 30 }))).toBe("Less than a minute left.");
    expect(spokenRemaining(parts({ done: true }))).toBe("This offer has ended.");
  });
});

describe("startCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks once a second, stops at zero and expires exactly once", () => {
    const seen: number[] = [];
    const onExpire = vi.fn();
    startCountdown({ endsAtMs: T0 + 3 * SECOND, offsetMs: 0, onTick: (p) => { seen.push(p.seconds); }, onExpire });

    expect(seen).toEqual([3]);
    vi.advanceTimersByTime(SECOND);
    expect(seen).toEqual([3, 2]);
    vi.advanceTimersByTime(SECOND);
    expect(seen).toEqual([3, 2, 1]);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SECOND);
    expect(seen).toEqual([3, 2, 1, 0]);
    expect(onExpire).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * SECOND);
    expect(seen).toEqual([3, 2, 1, 0]);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lines its ticks up with whole seconds of time left", () => {
    const seen: number[] = [];
    startCountdown({ endsAtMs: T0 + 2500, offsetMs: 0, onTick: (p) => { seen.push(p.seconds); } });
    expect(seen).toEqual([3]);
    vi.advanceTimersByTime(499);
    expect(seen).toEqual([3]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([3, 2]);
  });

  it("counts on the server's clock when this device is an hour slow", () => {
    vi.setSystemTime(T0 - HOUR);
    const offsetMs = clockOffsetMs(new Date(T0).toISOString(), Date.now());
    const frames: CountdownParts[] = [];
    const onExpire = vi.fn();
    startCountdown({ endsAtMs: T0 + 2 * SECOND, offsetMs, onTick: (p) => { frames.push(p); }, onExpire });

    expect(frames[0]).toMatchObject({ hours: 0, minutes: 0, seconds: 2, done: false });
    vi.advanceTimersByTime(2 * SECOND);
    expect(frames.at(-1)?.done).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("reads the clock again after a sleeping tab wakes, rather than counting ticks", () => {
    const frames: CountdownParts[] = [];
    startCountdown({ endsAtMs: T0 + 2 * HOUR, offsetMs: 0, onTick: (p) => { frames.push(p); } });
    // The tab sleeps for an hour: the clock moves, no timer fires in between.
    vi.setSystemTime(T0 + HOUR);
    vi.advanceTimersByTime(SECOND);
    expect(frames.at(-1)).toMatchObject({ hours: 0, minutes: 59, seconds: 59 });
  });

  it("expires straight away, once, when the deadline has already passed", () => {
    const onTick = vi.fn();
    const onExpire = vi.fn();
    startCountdown({ endsAtMs: T0 - MINUTE, offsetMs: 0, onTick, onExpire });
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick.mock.calls[0][0]).toMatchObject({ done: true });
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops ticking, and never expires, once it is stopped", () => {
    const onTick = vi.fn();
    const onExpire = vi.fn();
    const stop = startCountdown({ endsAtMs: T0 + 2 * SECOND, offsetMs: 0, onTick, onExpire });
    stop();
    vi.advanceTimersByTime(MINUTE);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a course offer's sale deadline", () => {
  const deadline = (over: Partial<CourseOfferDeadlineInfo> = {}): CourseOfferDeadlineInfo => ({
    endsAt: "2026-12-05T07:59:00.000Z",
    endsLabel: "Friday, December 4 at 11:59 PM PST",
    serverNow: "2026-12-01T20:00:00.000Z",
    showCountdown: true,
    closed: false,
    afterCloseUrl: "/checkout/full-price",
    ...over,
  });
  const offer = (slug: string, over: Partial<CourseOfferDeadlineInfo> | null = {}, available = true) => ({
    slug,
    available,
    deadline: over === null ? null : deadline(over),
  });

  it("picks the open sale that closes first and never an ended one", () => {
    const picked = timedOffer([
      offer("later", { endsAt: "2026-12-20T00:00:00.000Z" }),
      offer("ended", { endsAt: "2026-11-01T00:00:00.000Z", closed: true }),
      offer("soonest", { endsAt: "2026-12-03T00:00:00.000Z" }),
      offer("hidden", { endsAt: "2026-12-02T00:00:00.000Z", showCountdown: false }),
      offer("not-ready", { endsAt: "2026-12-02T00:00:00.000Z" }, false),
      offer("no-deadline", null),
    ]);
    expect(picked?.slug).toBe("soonest");
    expect(timedOffer([offer("ended", { closed: true })])).toBeUndefined();
    expect(timedOffer([])).toBeUndefined();
  });

  it("sends a closed offer's button to its destination, and only on this site", () => {
    expect(afterClosePath(deadline({ closed: true }))).toBe("/checkout/full-price");
    // Still on sale: the button keeps its own checkout.
    expect(afterClosePath(deadline())).toBe("");
    expect(afterClosePath(deadline({ closed: true, afterCloseUrl: "" }))).toBe("");
    expect(afterClosePath(deadline({ closed: true, afterCloseUrl: "//evil.example" }))).toBe("");
    expect(afterClosePath(deadline({ closed: true, afterCloseUrl: "https://evil.example" }))).toBe("");
    expect(afterClosePath(null)).toBe("");
  });
});

describe("splitCountdownBlocks", () => {
  it("leaves a body with no countdown line as one Markdown block", () => {
    const body = "# Hello\n\nSome **copy** here.\n";
    expect(splitCountdownBlocks(body)).toEqual([{ kind: "markdown", text: body }]);
  });

  it("splits at a countdown line and keeps everything else in order", () => {
    expect(splitCountdownBlocks("Intro copy.\n\n{countdown black-friday-bundle}\n\n## After\n\nMore.")).toEqual([
      { kind: "markdown", text: "Intro copy.\n" },
      { kind: "countdown", slug: "black-friday-bundle" },
      { kind: "markdown", text: "\n## After\n\nMore." },
    ]);
  });

  it("handles Windows line endings, trailing spaces and several timers", () => {
    expect(splitCountdownBlocks("{countdown one}  \r\nMiddle\r\n{countdown two}\r\n")).toEqual([
      { kind: "countdown", slug: "one" },
      { kind: "markdown", text: "Middle" },
      { kind: "countdown", slug: "two" },
    ]);
  });

  it("drops empty stretches between and around timers", () => {
    expect(splitCountdownBlocks("\n\n{countdown a}\n\n\n{countdown b}\n\n")).toEqual([
      { kind: "countdown", slug: "a" },
      { kind: "countdown", slug: "b" },
    ]);
    expect(splitCountdownBlocks("")).toEqual([]);
  });

  it("only counts a line that is exactly the marker", () => {
    for (const line of [
      "Use {countdown my-offer} in a sentence",
      "  {countdown my-offer}",
      "{countdown my-offer} now",
      "{countdown}",
      "{countdown two words}",
      "{ countdown my-offer }",
      "{Countdown my-offer}",
      "{countdown my-offer/../x}",
      // Shapes the server's slug pattern refuses, so the page never asks for them.
      "{countdown a--b}",
      "{countdown a-}",
      "{countdown -a}",
      "{countdown a.b}",
      `{countdown ${"a".repeat(201)}}`,
    ]) {
      expect(splitCountdownBlocks(line)).toEqual([{ kind: "markdown", text: line }]);
    }
  });

  it("lowercases and trims the slug so it matches what the server accepts", () => {
    expect(splitCountdownBlocks("{countdown Early-Bird}")).toEqual([{ kind: "countdown", slug: "early-bird" }]);
    expect(splitCountdownBlocks("{countdown  early_bird }")).toEqual([{ kind: "countdown", slug: "early_bird" }]);
    expect(cleanCountdownSlug(" Black-Friday_2026 ")).toBe("black-friday_2026");
    expect(cleanCountdownSlug("a--b")).toBeNull();
    expect(cleanCountdownSlug("")).toBeNull();
  });

  it("leaves the marker alone inside a fenced code block", () => {
    const body = "```\n{countdown my-offer}\n```";
    expect(splitCountdownBlocks(body)).toEqual([{ kind: "markdown", text: body }]);
  });

  it("does not touch other brace lines such as {checks}", () => {
    const body = "{checks}\n- one\n- two";
    expect(splitCountdownBlocks(body)).toEqual([{ kind: "markdown", text: body }]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CountdownView, OfferCountdown } from "./OfferCountdown";
import { startCountdown, type CountdownParts, type OfferDeadlineInfo } from "@/lib/countdown";

// The timer never asks the server during a server render; this only keeps the
// real request client out of the test.
vi.mock("@/lib/commerceApi", () => ({ fetchCountdownStatus: vi.fn() }));

const T0 = Date.parse("2026-12-04T07:58:57.000Z");
const LABEL = "Friday, December 4 at 11:59 PM PST";

const deadline = (over: Partial<OfferDeadlineInfo> = {}): OfferDeadlineInfo => ({
  endsAt: "2026-12-05T07:59:00.000Z",
  endsLabel: LABEL,
  serverNow: new Date(T0).toISOString(),
  showCountdown: true,
  ...over,
});

const parts = (over: Partial<CountdownParts> = {}): CountdownParts => ({
  days: 2, hours: 3, minutes: 4, seconds: 5, done: false, ...over,
});

/** The figures in the four boxes, in order. */
const figures = (html: string) =>
  [...html.matchAll(/tabular-nums text-white sm:text-2xl">(\d+)</g)].map((m) => m[1]);

describe("OfferCountdown on the server and on first paint", () => {
  it("is the plain deadline sentence, with no ticking figures", () => {
    const html = renderToStaticMarkup(<OfferCountdown deadline={deadline()} />);
    expect(html).toContain('data-countdown="static"');
    expect(html).toContain("Offer ends");
    expect(html).toContain(LABEL);
    expect(html).not.toContain('role="timer"');
    expect(figures(html)).toEqual([]);
    expect(html).not.toMatch(/Days|Hours|Min|Sec/);
  });

  it("renders the same thing every time, so hydration has nothing to disagree with", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const first = renderToStaticMarkup(<OfferCountdown slug="early-bird" deadline={deadline()} />);
      vi.setSystemTime(T0 + 90_000);
      expect(renderToStaticMarkup(<OfferCountdown slug="early-bird" deadline={deadline()} />)).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws nothing when the owner has switched the countdown off", () => {
    expect(renderToStaticMarkup(<OfferCountdown deadline={deadline({ showCountdown: false })} />)).toBe("");
  });

  it("still draws it for a funnel line the owner typed herself", () => {
    const html = renderToStaticMarkup(<OfferCountdown deadline={deadline({ showCountdown: false })} ignoreToggle />);
    expect(html).toContain(LABEL);
  });

  it("draws nothing with no deadline, or with only a slug still to be looked up", () => {
    expect(renderToStaticMarkup(<OfferCountdown />)).toBe("");
    expect(renderToStaticMarkup(<OfferCountdown deadline={null} />)).toBe("");
    expect(renderToStaticMarkup(<OfferCountdown slug="early-bird" ignoreToggle />)).toBe("");
  });
});

describe("CountdownView once the clock is running", () => {
  it("shows days, hours, minutes and seconds beside the deadline", () => {
    const html = renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={parts()} />);
    expect(html).toContain('data-countdown="live"');
    expect(figures(html)).toEqual(["02", "03", "04", "05"]);
    for (const label of ["Days", "Hours", "Min", "Sec"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain(LABEL);
  });

  it("sets the figures in the body face, bold, with tabular numerals", () => {
    const html = renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={parts()} />);
    expect(html).toContain("font-bold leading-none tabular-nums");
    expect(html).not.toContain("font-display");
  });

  it("is a timer that does not announce every second, with a sentence for screen readers", () => {
    const html = renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={parts()} />);
    expect(html).toMatch(/role="timer" aria-live="off"/);
    expect(html).toContain('<span class="sr-only">2 days, 3 hours and 4 minutes left.</span>');
    // The boxes are decoration to a screen reader: the sentence carries it.
    expect(html).toMatch(/<div aria-hidden="true" class="grid grid-cols-4/);
  });

  it("keeps the spoken sentence still while only the seconds change", () => {
    const spoken = (seconds: number) =>
      /class="sr-only">([^<]*)</.exec(
        renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={parts({ seconds })} />),
      )?.[1];
    expect(spoken(59)).toBe(spoken(1));
  });

  it("shows more than 99 days in full", () => {
    const html = renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={parts({ days: 120 })} />);
    expect(figures(html)[0]).toBe("120");
  });

  it("says the offer has ended, with no boxes, at zero", () => {
    const done = { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
    for (const html of [
      renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={done} />),
      renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={null} ended />),
    ]) {
      expect(html).toContain('data-countdown="ended"');
      expect(html).toContain("This offer has ended.");
      expect(html).not.toContain('role="timer"');
      expect(figures(html)).toEqual([]);
    }
  });

  it("uses no em dashes in what a visitor reads", () => {
    const html = [
      renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={null} />),
      renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={parts()} />),
      renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={null} ended />),
    ].join("");
    expect(html).not.toContain("—");
  });
});

describe("static first, then live, then ended", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes from the plain sentence to ticking figures to the ended line, expiring once", () => {
    // What the hook does after mount, driven by hand: `current` is the state it
    // would hold, and each frame is what the banner draws for it.
    let current: CountdownParts | null = null;
    const frame = () => renderToStaticMarkup(<CountdownView endsLabel={LABEL} parts={current} />);
    const onExpire = vi.fn();

    // Before mount: no clock has run.
    expect(frame()).toContain('data-countdown="static"');
    expect(figures(frame())).toEqual([]);

    const stop = startCountdown({
      endsAtMs: T0 + 3000,
      offsetMs: 0,
      onTick: (next) => {
        current = next;
      },
      onExpire,
    });

    expect(figures(frame())).toEqual(["00", "00", "00", "03"]);
    vi.advanceTimersByTime(1000);
    expect(figures(frame())).toEqual(["00", "00", "00", "02"]);
    vi.advanceTimersByTime(1000);
    expect(figures(frame())).toEqual(["00", "00", "00", "01"]);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(frame()).toContain('data-countdown="ended"');
    expect(frame()).toContain("This offer has ended.");
    expect(onExpire).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    stop();
  });
});

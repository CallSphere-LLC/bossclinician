import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { LiveRoomCallout, liveCallCopy } from "./LiveRoomCallout";

/**
 * QA row 43: "i don't see the web calling feature in community page". The
 * call now sits at the top of every community page as a card that says what
 * it is and offers one plain button.
 */
const OPEN = { open: true, youAreHost: false, closedReason: "", full: false, occupancy: 0 };

describe("LiveRoomCallout", () => {
  it("renders a labelled call card linking to the room", () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/community/the-boss">
        <LiveRoomCallout slug="the-boss" label="Office Hours" href="/community/the-boss/live" />
      </StaticRouter>,
    );
    expect(html).toContain('aria-label="Community video call"');
    expect(html).toContain("Live video call");
    expect(html).toContain("Office Hours");
    expect(html).toContain('href="/community/the-boss/live"');
    expect(html).toContain("Start a call");
  });

  it("offers to start an empty room and to join a busy one", () => {
    expect(liveCallCopy(OPEN, false)).toMatchObject({ action: "Start a call", busy: false });
    const busy = liveCallCopy({ ...OPEN, occupancy: 2 }, false);
    expect(busy.action).toBe("Join the call");
    expect(busy.status).toBe("2 people are in the call now.");
    expect(liveCallCopy({ ...OPEN, occupancy: 1 }, false).status).toBe("1 person is in the call now.");
  });

  it("explains a host-only room that is shut, but not to a host", () => {
    const shut = liveCallCopy({ ...OPEN, open: false, closedReason: "Opens when Yvette is here." }, false);
    expect(shut).toMatchObject({ shut: true, action: "See the room", status: "Opens when Yvette is here." });
    expect(liveCallCopy({ ...OPEN, open: false, youAreHost: true }, false).shut).toBe(false);
  });

  it("says so when the room is full, and brings a caller back to their call", () => {
    expect(liveCallCopy({ ...OPEN, full: true, occupancy: 8 }, false).status).toMatch(/full/);
    expect(liveCallCopy({ ...OPEN, occupancy: 3 }, true)).toMatchObject({
      action: "Back to your call",
      status: "You're in the call now.",
      busy: true,
    });
  });
});

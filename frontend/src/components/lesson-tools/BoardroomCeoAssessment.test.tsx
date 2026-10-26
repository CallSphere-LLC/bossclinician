import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { BoardroomCeoAssessment } from "./BoardroomCeoAssessment";

const mock = vi.hoisted(() => ({ status: "idle", ready: true, preview: false }));
vi.mock("@/hooks/useMember", () => ({ useMember: () => ({ member: { id: 100, timezone: "America/Los_Angeles" } }) }));
vi.mock("@/components/player/playerSource", () => ({ usePlayerSource: () => ({ preview: mock.preview }) }));
vi.mock("./useVersionedToolState", () => ({ useVersionedToolState: () => ({ state: { responses: Array(12).fill(0) }, setState: vi.fn(), status: mock.status, ready: mock.ready, savedAt: null, reload: vi.fn() }) }));

function render() { return renderToStaticMarkup(<MemoryRouter><BoardroomCeoAssessment /></MemoryRouter>); }
describe("CEO assessment safe initial states", () => {
  it("shows the source questions and progress without inventing a completed result", () => {
    mock.status = "idle"; mock.ready = true; mock.preview = false;
    const html = render();
    expect(html).toContain("How consistently do you review complete financial information before decisions?");
    expect(html).toContain("0 of 12 answered.");
    expect(html).not.toContain("Your CEO Strategic Baseline Report");
    expect(html).not.toContain("50 / 100");
  });
  it("disables input until saved answers load and offers a retry on failed load", () => {
    mock.status = "offline"; mock.ready = false;
    const html = render();
    expect(html).toContain("Retry loading my answers");
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });
  it("makes cross-device conflict recovery explicit and protects the local draft", () => {
    mock.status = "conflict"; mock.ready = true;
    const html = render();
    expect(html).toContain("Download my unsaved answers");
    expect(html).toContain("Reload saved answers");
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });
});

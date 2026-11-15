import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateRaiseLab } from "./RateRaiseLab";

const mock = vi.hoisted(() => ({
 member: {id: "member-a"} as {id: string; impersonatedBy?: string} | null,
 preview: false,
 state: {version: 1, fields: {rate: 120}},
 status: "idle",
 ready: true,
 reload: vi.fn(),
 save: vi.fn(),
 request: vi.fn(),
 effects: [] as Array<() => unknown>,
 setters: [] as Array<ReturnType<typeof vi.fn>>,
 iframe: null as null | object,
 html: "",
}));
vi.mock("react", async (importOriginal) => ({
 ...await importOriginal<typeof import("react")>(),
 useEffect: (effect: () => unknown) => { mock.effects.push(effect); },
 useCallback: (callback: unknown) => callback,
 useRef: (initial: unknown) => ({current: initial === null ? mock.iframe : initial}),
 useState: (initial: unknown) => {
  const setter = vi.fn();
  mock.setters.push(setter);
  return [initial === "" ? mock.html : initial, setter];
 },
}));
vi.mock("./rate-raise-runtime.js?url", () => ({default: "/assets/rate-raise.js"}));
vi.mock("@/hooks/useMember", () => ({useMember: () => ({member: mock.member})}));
vi.mock("@/components/player/playerSource", () => ({usePlayerSource: () => ({preview: mock.preview})}));
vi.mock("@/lib/memberApi", () => ({memberRequest: mock.request}));
vi.mock("./useVersionedToolState", () => ({useVersionedToolState: () => ({
 state: mock.state, status: mock.status, ready: mock.ready, reload: mock.reload, setState: mock.save,
})}));

type Node = ReactElement<{children?: Node | Node[] | string; [key: string]: unknown}>;
function render(): Node {
 const component = RateRaiseLab();
 return typeof component.type === "function" ? (component.type as () => Node)() : component as Node;
}
function children(node: Node): Node[] {
 return Array.isArray(node.props.children) ? node.props.children.filter(Boolean) : [];
}
function mount() {
 return mock.effects.map(effect => effect());
}
function listener() {
 const add = window.addEventListener as ReturnType<typeof vi.fn>;
 const event = add.mock.calls.find((call) => call[0] === "message");
 expect(event).toBeDefined();
 return event![1] as (event: Partial<MessageEvent>) => void;
}
const post = vi.fn();
const contentWindow = {postMessage: post} as unknown as Window;
const change = {channel: "boss-rate-lab-v1", type: "change", state: {version: 1, fields: {rate: 132}}};

beforeEach(() => {
 vi.clearAllMocks();
 mock.member = {id: "member-a"};
 mock.preview = false;
 mock.status = "idle";
 mock.ready = true;
 mock.effects.length = 0;
 mock.setters.length = 0;
 mock.html = "";
 mock.iframe = {contentWindow};
 mock.request.mockResolvedValue({html: "<p>private lab</p>"});
 vi.stubGlobal("window", {addEventListener: vi.fn(), removeEventListener: vi.fn(), location: {origin: "https://www.bossclinician.com"}});
});
afterEach(() => vi.unstubAllGlobals());

describe("Rate Raise Lab member boundary", () => {
 it.each(["preview", "signed-out"])("does not fetch the document in %s", (mode) => {
  if (mode === "preview") mock.preview = true;
  else mock.member = null;
  const tree = render();
  mount();
  expect(tree.type).toBe("p");
  expect(tree.props.children).toMatch(mode === "preview" ? /Preview/ : /sign in/i);
  expect(mock.request).not.toHaveBeenCalled();
 });

 it("loads the private document with an opaque, script-enabled sandbox", async () => {
  mock.request.mockResolvedValueOnce({html: '<body data-parent="__RATE_LAB_ORIGIN__"><script src="__RATE_LAB_RUNTIME_URL__"></script></body>'});
  mock.html = '<body data-parent="https://www.bossclinician.com"><script src="https://www.bossclinician.com/assets/rate-raise.js"></script></body>';
  const tree = render();
  mount();
  await Promise.resolve();
  expect(mock.request).toHaveBeenCalledExactlyOnceWith("/member/tool-document/rate-raise-lab?expectedMemberId=member-a");
  expect(mock.setters[0]).toHaveBeenCalledWith(mock.html);
  const frame = children(tree).find((n) => n.type === "iframe");
  expect(frame?.props).toMatchObject({srcDoc: mock.html, referrerPolicy: "no-referrer"});
  const flags = String(frame?.props.sandbox).split(" ");
  expect(flags).toContain("allow-scripts");
  expect(flags).not.toContain("allow-same-origin");
  expect(flags).not.toContain("allow-forms");
 });

 it.each([["loading", false], ["readonly", true], ["offline", true]] as const)(
  "withholds a fetched document when progress is %s",
  (status, ready) => {
   mock.html = "<p>private lab</p>";
   mock.status = status;
   mock.ready = ready;
   expect(children(render()).some(child => child.type === "iframe")).toBe(false);
  }
 );

 it("rekeys the session on member switch and discards an old pending document", async () => {
  let resolve!: (value: {html: string}) => void;
  mock.request.mockReturnValueOnce(new Promise((accept) => {resolve = accept;}));
  const first = RateRaiseLab();
  render();
  const cleanups = mount();
  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  mock.member = {id: "member-b"};
  expect(RateRaiseLab().key).not.toBe(first.key);
  expect(children(render()).some((child) => child.type === "iframe")).toBe(false);
  resolve({html: "<p>old member</p>"});
  await Promise.resolve();
  expect(mock.setters[0]).not.toHaveBeenCalled();
 });
 it("rejects messages from other windows or origins and only saves allowlisted state", () => {
  render(); mount();
  const receive = listener();
  receive({source: {} as Window, origin: "null", data: change});
  receive({source: contentWindow, origin: "https://www.bossclinician.com", data: change});
  receive({source: contentWindow, origin: "null", data: {...change, channel: "other"}});
  receive({source: contentWindow, origin: "null", data: {...change, state: {version: 1, fields: {notes: "not persistent"}}}});
  expect(mock.save).not.toHaveBeenCalled();
  receive({source: contentWindow, origin: "null", data: {...change, type: "ready"}});
  expect(post).toHaveBeenLastCalledWith({channel: change.channel, type: "restore", state: mock.state, editable: true}, "*");
  receive({source: contentWindow, origin: "null", data: change});
  expect(mock.save).toHaveBeenCalledExactlyOnceWith(change.state);
 });

 it.each([["conflict", /changed on another device/], ["readonly", /Read-only/]])(
  "blocks writes and offers reload when %s",
  (status, message) => {
   mock.status = status;
   const tree = render();
   mount();
   expect(children(tree).find(n => n.props.role === "status")?.props.children).toMatch(message);
   expect(post).toHaveBeenLastCalledWith({channel: change.channel, type: "restore", state: mock.state, editable: false}, "*");
   listener()({source: contentWindow, origin: "null", data: change});
   expect(mock.save).not.toHaveBeenCalled();
   const reload = children(tree).find(n => n.type === "button")?.props.onClick as () => void;
   reload();
   expect(mock.reload).toHaveBeenCalledOnce();
  }
 );
});

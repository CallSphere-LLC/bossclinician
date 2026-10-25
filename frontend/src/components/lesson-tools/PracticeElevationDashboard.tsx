import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { usePlayerSource } from "@/components/player/playerSource";
import { memberRequest } from "@/lib/memberApi";
import prototype from "./practice-elevation-v4.html?raw";
import runtimeUrl from "./practice-elevation-v4-runtime.js?url";
import { SaveBadge, ActionButton, downloadFile } from "./DashboardKit";
import {
  SNAPSHOT_V2_KEY,
  allowedLessonSlugs,
  growthDefaults,
  normaliseGrowth,
  resolveRoutes,
  snapshotLessons,
  snapshotSuggestion,
  type OutlineLike,
  type SnapshotSuggestion,
} from "./elevationV4";
import { useVersionedToolState } from "./useVersionedToolState";

/**
 * The owner's Practice Elevation dashboard (rows 103/150), run in a sandboxed
 * frame. Besides the member's saved state, the frame is sent:
 * - `routes` (row 170): the recommended module and specific lessons for every
 *   pathway, checked against the live course outline, so the assessment results
 *   name the module and link the lessons;
 * - `snapshot`: what the member's Practice Reset Snapshot (row 158, read-only
 *   here) suggests, offered as a starting pathway the member can accept or
 *   ignore — it never replaces anything they have chosen.
 */
export function PracticeElevationDashboard() {
  const frameDocument = useMemo(() => {
    const origin = typeof window === "undefined" ? "https://www.bossclinician.com" : window.location.origin;
    return prototype.replace("__BC_SCRIPT_ORIGIN__", origin).replace("__BC_RUNTIME__", new URL(runtimeUrl, origin).href);
  }, []);
  const tool = useVersionedToolState("practice-elevation-dashboard", growthDefaults, normaliseGrowth);
  const source = usePlayerSource();
  const params = useParams();
  const navigate = useNavigate();
  const productSlug = params.productSlug ?? "";
  const frame = useRef<HTMLIFrameElement>(null);
  const lastFromFrame = useRef("");
  const [height, setHeight] = useState(1000);
  const [outline, setOutline] = useState<OutlineLike | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotSuggestion | null>(null);
  const latest = useRef(tool); latest.current = tool;

  // The course outline, once: live lesson titles for the recommendations, and
  // the lessons that exist. A failure leaves the built-in table in place.
  useEffect(() => {
    let live = true;
    source.api.getProduct(productSlug).then((product) => {
      if (live && product.kind === "course" && Array.isArray(product.course?.modules)) setOutline(product.course);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [source.api, productSlug]);

  // The Practice Reset Snapshot's saved result, read once. Nothing in a preview
  // (no member), and nothing at all if the snapshot lesson is not open to them.
  useEffect(() => {
    if (source.preview) return;
    let live = true;
    memberRequest<{state: unknown}>(`/member/tool-state/${encodeURIComponent(SNAPSHOT_V2_KEY)}`)
      .then((result) => { if (live) setSnapshot(snapshotSuggestion(result.state)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [source.preview]);

  const routes = useMemo(() => resolveRoutes(outline), [outline]);
  const snapshotPayload = useMemo(() => snapshot && {...snapshot, lessons: snapshotLessons(snapshot.lessonIds, outline)}, [snapshot, outline]);
  const extras = useRef({routes, snapshot: snapshotPayload}); extras.current = {routes, snapshot: snapshotPayload};
  const allowed = useRef(allowedLessonSlugs(outline)); allowed.current = allowedLessonSlugs(outline);

  const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({channel:"bc-growth", ...message}, "*");
  const publishExtras = () => post({type:"routes", routes:extras.current.routes, snapshot:extras.current.snapshot});
  const publish = () => {
    publishExtras();
    post({type:"state", state:latest.current.state, readonly:["readonly","conflict"].includes(latest.current.status)});
  };
  const openLesson = useRef((slug: string) => navigate(source.lessonPath(productSlug, slug)));
  openLesson.current = (slug: string) => navigate(source.lessonPath(productSlug, slug));

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "bc-growth") return;
      if (event.data.type === "ready") publish();
      if (event.data.type === "height" && Number.isFinite(event.data.height)) setHeight(Math.max(600,Math.min(10000,event.data.height)));
      if (["save","restore"].includes(event.data.type)) {
        if (["readonly","conflict","offline","loading"].includes(latest.current.status)) return;
        const next = normaliseGrowth(event.data.state);
        lastFromFrame.current = JSON.stringify(next);
        latest.current.setState(next);
        if (event.data.type === "restore") post({type:"state",state:next});
      }
      if (event.data.type === "lesson" && typeof event.data.slug === "string" && allowed.current.has(event.data.slug)) {
        openLesson.current(event.data.slug);
      }
    };
    window.addEventListener("message",receive); return () => window.removeEventListener("message",receive);
  }, []);
  useEffect(() => { if (JSON.stringify(tool.state) !== lastFromFrame.current) publish(); }, [tool.state]);
  useEffect(() => { publishExtras(); }, [routes, snapshotPayload]);
  useEffect(() => { post({type:"access",readonly:["readonly","conflict"].includes(tool.status)}); }, [tool.status]);
  return <section aria-label="Practice Elevation Growth Dashboard" className="min-w-0">
    <SaveBadge status={tool.status} savedAt={tool.savedAt} />
    {tool.status === "conflict" && <div role="alert" className="my-3 flex flex-wrap gap-3 rounded-xl border p-4"><ActionButton onClick={() => downloadFile("practice-elevation-local-copy.json",JSON.stringify(tool.state,null,2),"application/json")}>Download my local copy</ActionButton><ActionButton onClick={() => { if (window.confirm("Load the latest saved version? Download your local copy first if you need to keep these unsaved edits.")) { lastFromFrame.current = ""; void tool.reload(); } }}>Load latest saved version</ActionButton></div>}
    {tool.status === "offline" && <ActionButton onClick={() => void tool.reload()}>Retry loading my dashboard</ActionButton>}
    {tool.ready && <iframe ref={frame} title="My Practice Elevation Dashboard" sandbox="allow-scripts allow-downloads allow-modals" srcDoc={frameDocument} onLoad={publish} style={{height}} className="mt-3 w-full rounded-2xl border-0 bg-white" />}
  </section>;
}

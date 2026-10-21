import { useEffect, useMemo, useRef, useState } from "react";
import prototype from "./practice-elevation-v4.html?raw";
import runtimeUrl from "./practice-elevation-v4-runtime.js?url";
import { SaveBadge, ActionButton, downloadFile } from "./DashboardKit";
import { growthDefaults, normaliseGrowth } from "./elevationV4";
import { useVersionedToolState } from "./useVersionedToolState";

export function PracticeElevationDashboard() {
  const frameDocument = useMemo(() => {
    const origin = typeof window === "undefined" ? "https://bossclinician.callsphere.site" : window.location.origin;
    return prototype.replace("__BC_SCRIPT_ORIGIN__", origin).replace("__BC_RUNTIME__", new URL(runtimeUrl, origin).href);
  }, []);
  const tool = useVersionedToolState("practice-elevation-dashboard", growthDefaults, normaliseGrowth);
  const frame = useRef<HTMLIFrameElement>(null);
  const lastFromFrame = useRef("");
  const [height, setHeight] = useState(1000);
  const latest = useRef(tool); latest.current = tool;
  const publish = () => frame.current?.contentWindow?.postMessage({channel:"bc-growth", type:"state", state:latest.current.state, readonly:["readonly","conflict"].includes(latest.current.status)}, "*");
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
        if (event.data.type === "restore") frame.current?.contentWindow?.postMessage({channel:"bc-growth",type:"state",state:next},"*");
      }
      if (event.data.type === "lesson" && typeof event.data.slug === "string") {
        const allowed = ["current-model-audit-worksheet","how-to-raise-your-rate-based-on-what-the-audit-showed-you","the-systems-stack-that-works-for-a-solo-or-small-practice","pay-yourself-salary-planning-worksheet","the-referral-rhythm-keep-clients-coming-without-starting-over-every-month","how-to-build-a-sustainable-session-load"];
        if (allowed.includes(event.data.slug)) window.location.assign(`/library/the-practice-elevation/lessons/${event.data.slug}`);
      }
    };
    window.addEventListener("message",receive); return () => window.removeEventListener("message",receive);
  }, []);
  useEffect(() => { if (JSON.stringify(tool.state) !== lastFromFrame.current) publish(); }, [tool.state]);
  useEffect(() => { frame.current?.contentWindow?.postMessage({channel:"bc-growth",type:"access",readonly:["readonly","conflict"].includes(tool.status)},"*"); }, [tool.status]);
  return <section aria-label="Practice Elevation Growth Dashboard" className="min-w-0">
    <SaveBadge status={tool.status} savedAt={tool.savedAt} />
    {tool.status === "conflict" && <div role="alert" className="my-3 flex flex-wrap gap-3 rounded-xl border p-4"><ActionButton onClick={() => downloadFile("practice-elevation-local-copy.json",JSON.stringify(tool.state,null,2),"application/json")}>Download my local copy</ActionButton><ActionButton onClick={() => { if (window.confirm("Load the latest saved version? Download your local copy first if you need to keep these unsaved edits.")) { lastFromFrame.current = ""; void tool.reload(); } }}>Load latest saved version</ActionButton></div>}
    {tool.status === "offline" && <ActionButton onClick={() => void tool.reload()}>Retry loading my dashboard</ActionButton>}
    {tool.ready && <iframe ref={frame} title="My Practice Elevation Dashboard" sandbox="allow-scripts allow-downloads allow-modals" srcDoc={frameDocument} onLoad={publish} style={{height}} className="mt-3 w-full rounded-2xl border-0 bg-white" />}
  </section>;
}

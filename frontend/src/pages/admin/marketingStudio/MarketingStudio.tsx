import { useEffect, useRef, useState } from "react";
import { ErrorNotice, Skeleton } from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { marketingStudioApi, type StudioDocument } from "./api";
import { mountStudio } from "./studioApp";
import "./studio.css";

/**
 * Marketing → Marketing Studio.
 *
 * Yvette's content planner (her developer brief of 31 Oct 2026, built from the
 * working reference she published as version 5): pick an audience, personalise
 * one of 365 evergreen hooks, edit the post, and plan it. Admin only; nothing
 * here is published or sent anywhere.
 *
 * The screen itself is the reference app's own logic (studioApp.ts) mounted
 * into a container, so its audience rules, resource routing, endings, backup
 * and restore behave exactly as in the version she approved. The difference is
 * where it saves: to her account rather than one browser.
 */
export default function MarketingStudio() {
  const host = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<StudioDocument | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    marketingStudioApi
      .load()
      .then((d) => live && setDoc(d))
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!doc || !host.current) return;
    const studio = mountStudio(host.current, {
      initial: doc.state,
      version: doc.version,
      recovery: doc.recovery,
      save: marketingStudioApi.save,
    });
    return () => studio.destroy();
  }, [doc]);

  if (error) return <ErrorNotice message={friendlyError(error, "studio")} />;
  if (!doc) return <Skeleton className="h-[70vh] w-full" />;
  return <div ref={host} className="ms-root ms-embed" data-testid="marketing-studio" />;
}

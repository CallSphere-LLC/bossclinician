import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Loader2, Maximize2 } from "lucide-react";
import { usePlayerSource } from "@/components/player/playerSource";
import { RetreatDashboard } from "@/components/retreats/RetreatDashboard";
import { BUTTON_OUTLINE } from "@/components/retreats/retreatUi";
import { adminRetreatsApi, memberRetreatsApi, type MemoriesView, type RetreatDashboardData } from "@/lib/retreatsApi";

/**
 * tool_key "flourishealer-retreat-dashboard" (migration 218): the retreat
 * dashboard as the one lesson of the "FlourisHealer Retreats — Bali 2027"
 * course. `tool_config.retreat` names the retreat slug.
 *
 * In the admin's "Preview as student" there is no member session, so the tool
 * reads the owner-only preview endpoint instead and never touches /member/*.
 */
export const RETREAT_DASHBOARD_KEY = "flourishealer-retreat-dashboard";

export function retreatSlugFrom(toolConfig: unknown): string | null {
  if (!toolConfig || typeof toolConfig !== "object") return null;
  const slug = (toolConfig as { retreat?: unknown }).retreat;
  return typeof slug === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

const EMPTY_MEMORIES = async (): Promise<MemoriesView> => ({
  available: false,
  uploadsOpen: false,
  requireReview: true,
  maxPhotoMb: 20,
  maxVideoMb: 200,
  items: [],
});

export function RetreatDashboardTool({ toolConfig }: { toolConfig?: unknown }) {
  const { preview } = usePlayerSource();
  const slug = retreatSlugFrom(toolConfig);
  const [data, setData] = useState<RetreatDashboardData | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!slug) {
      setMessage("This retreat dashboard isn't set up yet.");
      return;
    }
    try {
      setData(preview ? await adminRetreatsApi.previewBySlug(slug) : await memberRetreatsApi.dashboard(slug));
      setMessage("");
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 0;
      if (preview) setMessage("The retreat dashboard preview is available to the owner under Admin › Retreats.");
      else if (status === 404 || status === 403) setMessage("Your retreat dashboard is being prepared. We'll let you know when it's ready.");
      else setMessage(error instanceof Error ? error.message : "We couldn't open your retreat dashboard.");
    }
  }, [slug, preview]);

  useEffect(() => {
    void load();
  }, [load]);

  if (message) return <p className="rounded-2xl border border-gold/25 bg-gold/[0.06] px-5 py-6 text-sm text-orchid">{message}</p>;
  if (!data || !slug) {
    return (
      <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Opening your retreat dashboard…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!preview && (
        <div>
          <Link to={`/retreats/dashboard/${encodeURIComponent(slug)}`} className={BUTTON_OUTLINE}>
            <Maximize2 aria-hidden className="size-4" /> Open full screen
          </Link>
        </div>
      )}
      <RetreatDashboard
        data={data}
        slug={slug}
        preview={preview ? { memories: EMPTY_MEMORIES } : undefined}
        onReload={preview ? undefined : () => void load()}
      />
    </div>
  );
}

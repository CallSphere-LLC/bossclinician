import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Eye } from "lucide-react";
import { RetreatDashboard } from "@/components/retreats/RetreatDashboard";
import { adminRetreatsApi, type AdminRetreatDetail, type RetreatDashboardData } from "@/lib/retreatsApi";

/**
 * Owner preview of the guest dashboard — /admin/retreats/:id/preview.
 *
 * Without ?memberId it is what a brand-new guest would see; with it, that
 * guest's own dashboard, read-only. Either way nobody is impersonated, no
 * member session exists and nothing can be saved (the API answers this from
 * owner/admin-only routes and the dashboard renders in preview mode).
 *
 * Outside AdminLayout, like the course preview: the guest's own dark chrome is
 * the point of looking at it.
 */
export default function RetreatPreview() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const id = Number(params.id);
  const memberId = Number(search.get("memberId")) || undefined;
  const audienceParam = search.get("audience");
  const audience: "all" | "private" | "shared" = audienceParam === "private" || audienceParam === "shared" ? audienceParam : "all";
  const [data, setData] = useState<RetreatDashboardData | null>(null);
  const [detail, setDetail] = useState<AdminRetreatDetail | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminRetreatsApi.preview(id, memberId, memberId ? undefined : audience), adminRetreatsApi.get(id)])
      .then(([dashboard, retreat]) => {
        if (cancelled) return;
        setData(dashboard);
        setDetail(retreat);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load the preview."));
    return () => {
      cancelled = true;
    };
  }, [id, memberId, audience, reload]);

  const preview = useMemo(() => ({ memories: () => adminRetreatsApi.previewMemories(id) }), [id]);

  return (
    <div className="theme-luxe min-h-screen bg-night-deep">
      <div className="sticky top-0 z-50 border-b border-gold/30 bg-night-raised/95 backdrop-blur">
        <div className="mx-auto flex max-w-8xl flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm sm:px-8">
          <p className="flex items-center gap-2 text-white/85">
            <Eye aria-hidden className="size-4 text-gold" />
            Owner preview — read-only. Guests can't see this{detail && !detail.published ? " until you publish it" : ""}.
            {memberId && data?.guest && <span className="text-orchid-dim"> Viewing {data.guest.firstName}'s dashboard.</span>}
          </p>
          {!memberId && (
            <label className="flex items-center gap-2 text-white/85">
              Preview as
              <select
                className="min-h-9 rounded-lg border border-white/20 bg-night-deep px-2 text-sm text-white"
                value={audience}
                onChange={(e) => {
                  const next = new URLSearchParams(search);
                  if (e.target.value === "all") next.delete("audience");
                  else next.set("audience", e.target.value);
                  setSearch(next, { replace: true });
                }}
              >
                <option value="all">Every question (marked by who sees it)</option>
                <option value="private">A private-room guest</option>
                <option value="shared">A shared-room guest</option>
              </select>
            </label>
          )}
          <Link to={`/admin/retreats/${id}`} className="inline-flex items-center gap-1.5 text-gold hover:underline">
            <ArrowLeft aria-hidden className="size-4" /> Back to the retreat
          </Link>
        </div>
      </div>
      <main className="mx-auto max-w-8xl px-5 pb-24 pt-8 sm:px-8 lg:px-12">
        {error && (
          <p role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
            {error}
          </p>
        )}
        {!data && !error && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <span className="size-9 animate-spin rounded-full border-2 border-lilac border-t-plum" role="status" aria-label="Loading" />
          </div>
        )}
        {data && <RetreatDashboard data={data} slug={data.retreat.slug} preview={preview} onReload={() => setReload((n) => n + 1)} />}
      </main>
    </div>
  );
}

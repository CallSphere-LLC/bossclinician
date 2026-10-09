import { useEffect, useState, type MouseEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { sessionFetch } from "@/lib/adminTransport";
import { CommunityLayout } from "@/components/community/CommunityLayout";
import { ChannelFeed } from "@/components/community/ChannelFeed";
import { CommunityPreviewContext, type CommunityPreviewData } from "@/components/community/communityPreview";

export default function CommunityPreview() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<CommunityPreviewData | null>(null);
  const [error, setError] = useState("");
  const query = params.toString();
  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    (async () => {
      try {
        const response = await sessionFetch(`/api/admin/community/${encodeURIComponent(id ?? "")}/preview?${query}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to open community preview.");
        if (!cancelled) setData(body);
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to open preview."); }
    })();
    return () => { cancelled = true; };
  }, [id, query]);

  // The preview may navigate between its own channels, but participant actions
  // (checkout, calls, profile, messages) never leave this read-only surface.
  function keepPreview(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor && !anchor.getAttribute("href")?.startsWith(`/admin/community/${id}/preview`)) {
      event.preventDefault(); event.stopPropagation();
      toast.info("Preview only — this action is available in the participant account.");
    }
  }
  const page = data?.feed?.page ?? 1;
  return <div className="theme-luxe min-h-screen bg-night-deep text-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/30 bg-night-raised px-5 py-3 text-sm">
      <div><strong className="text-gold">Participant preview</strong><p className="mt-1 text-white/75">Nothing is saved. Private invitations, personal messages and live calls are not included.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        {data && <><span>{data.archived ? "Archived" : data.published ? "Published" : "Draft"}</span>
          <label className="flex items-center gap-2">Access group
            <select aria-label="Preview access group" className="max-w-64 rounded-lg border border-white/25 bg-night-deep p-2 text-white" value={params.get("group") ?? "all"}
              onChange={e=>setParams({group:e.target.value})}>
              <option value="all">All access groups</option><option value="none">No access groups</option>
              {data.groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label></>}
        <Link className="rounded-full border border-gold/50 px-4 py-2 text-gold" to={`/admin/community/${id}`}>Back to community editor</Link>
      </div>
    </div>
    {error && <p role="alert" className="p-8 text-red-300">{error}</p>}
    {!data && !error && <p className="p-8">Opening participant preview…</p>}
    {data && <CommunityPreviewContext.Provider value={data}>
      <div onClickCapture={keepPreview} onAuxClickCapture={keepPreview}>
        <CommunityLayout key={`${id}:${query}`} slug={data.overview.community.slug} activeChannel={data.feed?.channel.slug}>
          {() => data.feed ? <>
            <ChannelFeed communitySlug={data.overview.community.slug} channelSlug={data.feed.channel.slug} role="member" />
            {(page>1 || data.feed.hasMore) && <nav aria-label="Preview post pages" className="mt-5 flex gap-3">
              {page>1 && <button className="rounded-lg border border-gold/40 px-4 py-2" onClick={()=>{const next=new URLSearchParams(params);next.set("page",String(page-1));setParams(next);}}>Newer posts</button>}
              {data.feed.hasMore && <button className="rounded-lg border border-gold/40 px-4 py-2" onClick={()=>{const next=new URLSearchParams(params);next.set("page",String(page+1));setParams(next);}}>Older posts</button>}
            </nav>}
          </> : <div className="rounded-2xl border border-white/10 p-8 text-center"><h2 className="font-display text-xl">This room is still being set up</h2><p className="mt-2 text-white/70">No channels are visible with these access groups.</p></div>}
        </CommunityLayout>
      </div>
    </CommunityPreviewContext.Provider>}
  </div>;
}

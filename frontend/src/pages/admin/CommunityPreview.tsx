import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { sessionFetch } from "@/lib/adminTransport";
import { adminApi } from "@/lib/api";
import { friendlyError } from "@/pages/admin/ui/friendly";
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

  /*
   * QA row 168: "when I try to add a comment … it's not allowing me to". The
   * preview is a snapshot with no member identity (nobody to write as), so it
   * stays read-only — but the owner gets a one-time host link that opens the
   * real community signed in as herself, in this channel, and on the post she
   * pressed Reply on. Same mechanism as "Start or join the call as host".
   */
  const [opening, setOpening] = useState(false);
  const channelSlug = data?.feed?.channel?.slug;
  const writeAsYourself = useCallback((target: { postId?: number } = {}) => {
    // Opened inside the click: a popup blocker only trusts a window.open that
    // happens in the gesture itself, and an await ends that (iPhone Safari too).
    const tab = window.open("", "_blank");
    if (!tab) {
      toast.error("Your browser blocked the new tab. Allow pop-ups for the admin and try again.");
      return;
    }
    tab.opener = null;
    setOpening(true);
    adminApi
      .communityHostLink(Number(id), { channel: channelSlug, post: target.postId })
      .then(({ url }) => { tab.location.href = url; })
      .catch((err) => { tab.close(); toast.error(friendlyError(err, "community")); })
      .finally(() => setOpening(false));
  }, [id, channelSlug]);
  const context = useMemo(() => (data ? { ...data, writeAsYourself } : null), [data, writeAsYourself]);

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
      <div><strong className="text-gold">Participant preview</strong><p className="mt-1 text-white/75">This is what a participant sees, and nothing done here is saved. To post or reply, use “Post or reply as yourself” — it opens the community signed in as you. Private invitations, personal messages and live calls are not included.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        {data && <><span>{data.archived ? "Archived" : data.published ? "Published" : "Draft"}</span>
          <label className="flex items-center gap-2">Access group
            <select aria-label="Preview access group" className="max-w-64 rounded-lg border border-white/25 bg-night-deep p-2 text-white" value={params.get("group") ?? "all"}
              onChange={e=>setParams({group:e.target.value})}>
              <option value="all">All access groups</option><option value="none">No access groups</option>
              {data.groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label></>}
        {data && <button type="button" disabled={opening || !data.published} onClick={()=>writeAsYourself()}
          title={data.published ? "Opens the community in a new tab, signed in as you" : "Publish the community first — members can't see a draft, so there is nowhere to post yet."}
          className="rounded-full bg-gold px-4 py-2 font-semibold text-night-deep disabled:opacity-60">
          {opening ? "Opening…" : "Post or reply as yourself"}
        </button>}
        <Link className="rounded-full border border-gold/50 px-4 py-2 text-gold" to={`/admin/community/${id}`}>Back to community editor</Link>
      </div>
    </div>
    {error && <p role="alert" className="p-8 text-red-300">{error}</p>}
    {!data && !error && <p className="p-8">Opening participant preview…</p>}
    {data && <CommunityPreviewContext.Provider value={context}>
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

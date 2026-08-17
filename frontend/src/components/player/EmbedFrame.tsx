/**
 * An `embed` lesson: author-written markup, run in a sandbox.
 *
 * The markup comes from the admin rather than from a member, so this is not a
 * defence against a hostile customer — it is a defence against the ordinary
 * case, which is a snippet pasted from Vimeo, Typeform or Calendly carrying
 * whatever script that vendor ships this week. Rendering it into our own
 * document would give that script the member's session; `srcdoc` without
 * `allow-same-origin` gives it an opaque origin instead, where it can play a
 * video and reach nothing of ours.
 *
 * `dangerouslySetInnerHTML` is deliberately absent. There is no version of this
 * component that inlines the markup.
 */

/**
 * The document the snippet is dropped into.
 *
 * The reset matters: a pasted iframe usually carries fixed pixel dimensions, and
 * without this it renders at 560x315 in the middle of a black rectangle on every
 * screen size. Stretching it to the frame is what makes the embed responsive.
 */
function shell(markup: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;padding:0;height:100%;background:#06040B;
    color:#B9A2D6;font-family:Montserrat,Arial,sans-serif}
  iframe,video,embed,object{display:block;width:100%;height:100%;border:0}
  img{max-width:100%;height:auto}
</style></head><body>${markup}</body></html>`;
}

interface EmbedFrameProps {
  html: string;
  title: string;
  /** Some embeds (a form, a checklist) are portrait; 16:9 would letterbox them. */
  aspect?: "video" | "tall";
}

export function EmbedFrame({ html, title, aspect = "video" }: EmbedFrameProps) {
  if (!html.trim()) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-orchid-dim">
        This lesson&rsquo;s content is not available yet. Please check back shortly.
      </p>
    );
  }

  return (
    <div
      className={
        aspect === "video"
          ? "aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-glass"
          : "h-[38rem] max-h-[80vh] w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-glass"
      }
    >
      <iframe
        title={title}
        srcDoc={shell(html)}
        // No `allow-same-origin`: with it, the sandbox attribute is decorative.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        className="size-full border-0"
      />
    </div>
  );
}

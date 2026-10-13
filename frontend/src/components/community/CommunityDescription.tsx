import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { safeHref } from "@/lib/safeHref";
import { withHardBreaks } from "./descriptionFormat";

/**
 * The description Yvette writes under Manage > Details, as participants read it.
 *
 * The same renderer and configuration as lesson bodies and the guidelines: no
 * raw HTML (react-markdown escapes it) and its default URL filter refuses
 * `javascript:` links. Line breaks she typed are kept, so descriptions written
 * as plain text before formatting existed look exactly as they did.
 */
export function CommunityDescription({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return (
    <div
      className={cn(
        "prose-boss break-words text-[1.03rem] prose-headings:font-semibold prose-headings:tracking-normal",
        "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:my-3 [&>*:first-child]:mt-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const safe = href ? safeHref(href) : undefined;
            if (!safe) return <>{children}</>;
            const external = /^https?:/i.test(safe);
            return (
              <a
                href={safe}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {withHardBreaks(text)}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The community's cover photo as a banner. Renders nothing without one, so a
 * community with no cover keeps exactly the look it had.
 *
 * Media library URLs are root-relative (`/uploads/…`), so `safeHref` rather
 * than an http-only check.
 */
export function CommunityCover({
  src,
  className,
  imgClassName,
}: {
  src?: string | null;
  className?: string;
  imgClassName?: string;
}) {
  const safe = src?.trim() ? safeHref(src.trim()) : undefined;
  if (!safe) return null;
  return (
    <div className={cn("overflow-hidden bg-night-raised", className)}>
      <img
        src={safe}
        alt=""
        decoding="async"
        className={cn("size-full object-cover", imgClassName)}
      />
    </div>
  );
}

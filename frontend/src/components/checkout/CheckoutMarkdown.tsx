import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { safeHref } from "@/lib/safeHref";
import { prepareCheckoutMarkdown, remarkCheckoutStyles } from "./checkoutMarkdown";
import "./checkoutMarkdown.css";

/**
 * Links on a checkout open in a new tab: a buyer who follows one mid-order
 * must come back to the form they had half filled in, not an empty one.
 */
const COMPONENTS: Components = {
  a: ({ href, children, className }) => {
    const safe = href ? safeHref(href) : undefined;
    if (!safe) return <>{children}</>;
    return (
      <a href={safe} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img: ({ src, alt, title, className }) => {
    const safe = typeof src === "string" && src.trim() ? safeHref(src.trim()) : undefined;
    if (!safe || /^(mailto|tel):/i.test(safe)) return null;
    return (
      <img
        src={safe}
        alt={alt ?? ""}
        title={title}
        loading="lazy"
        decoding="async"
        className={cn("cm-photo", className)}
      />
    );
  },
  // A list that starts at "3." keeps counting from 3 in the gold circles,
  // which are drawn with a CSS counter rather than the browser's own numbers.
  ol: ({ start, children, className }) => (
    <ol
      start={start}
      className={className}
      style={typeof start === "number" && start !== 1 ? { counterReset: `cm-n ${start - 1}` } : undefined}
    >
      {children}
    </ol>
  ),
};

/**
 * The offer description as the checkout draws it (and as the admin's preview
 * and the offer editor's "See how it looks" draw it — one renderer for all
 * three, so what she previews is what buyers get).
 *
 * Markdown through react-markdown without rehype-raw: any HTML she types is
 * shown as text, never run. Link and image addresses go through `safeHref`,
 * which refuses `javascript:` and `data:`. Style lines (`{checks}`, `{serif}` —
 * see checkoutMarkdown.ts) only ever become classes from a fixed list.
 */
export function CheckoutMarkdown({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return (
    <div
      className={cn(
        "checkout-md prose-boss break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // Under the page's own headline, so a "#" in the pitch must not out-size it.
        "prose-headings:font-semibold prose-headings:tracking-normal prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:my-3",
        "[&_table]:block [&_table]:overflow-x-auto",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCheckoutStyles]} components={COMPONENTS}>
        {prepareCheckoutMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface ReceiptFrameHandle {
  /** Opens the print dialog for the receipt alone, not the page around it. */
  print: () => void;
}

interface ReceiptFrameProps {
  /** The server-rendered receipt document, already escaped by the server. */
  html: string;
  /** Accessible name for the frame. */
  title: string;
  className?: string;
}

/**
 * A server-rendered receipt, shown inside the page that asked for it.
 *
 * The receipt is one document rendered by the API for every surface (member,
 * admin, email PDF), so the page shows that document rather than rebuilding the
 * layout in React — a second renderer is how two copies of a receipt start to
 * disagree.
 *
 * `sandbox="allow-same-origin allow-modals"`, and deliberately no
 * `allow-scripts`: nothing in the markup can run, whatever it contains. Same
 * origin is what lets this page measure the document's height and print it;
 * modals is what lets that print dialog open.
 *
 * `srcDoc` rather than a blob: URL, because the site's CSP `frame-src` does not
 * list blob:. A srcdoc document inherits the page's own policy, which already
 * allows inline styles and data: images — everything a receipt uses.
 */
export const ReceiptFrame = forwardRef<ReceiptFrameHandle, ReceiptFrameProps>(
  function ReceiptFrame({ html, title, className }, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(960);

    const measure = useCallback(() => {
      const body = frame.current?.contentDocument?.body;
      if (!body) return;
      // The body's own box, not the document's scroll height: the latter never
      // reports less than the frame's current height, so it could only grow.
      setHeight(Math.ceil(body.getBoundingClientRect().height) + 2);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        print: () => frame.current?.contentWindow?.print(),
      }),
      [],
    );

    useEffect(() => {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }, [measure]);

    return (
      <iframe
        ref={frame}
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin allow-modals"
        onLoad={measure}
        style={{ height }}
        className={className ?? "block w-full rounded-2xl border-0 bg-[#f6f5f2]"}
      />
    );
  },
);

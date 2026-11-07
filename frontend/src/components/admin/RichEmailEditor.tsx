import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { emailHtml, RICH_EMAIL, safeEmailHtml } from "./emailMarkup";
import { isPlainPasteShortcut, PasteOptions, readClipboardText, usePastePreference } from "./smartPaste";
export interface RichEmailHandle {
  format: (id: string) => void;
  insert: (html: string) => void;
  insertText: (text: string) => void;
  font: (prop: "font-size" | "font-family", value: string) => void;
}
const BLOCK = /^(H[1-6]|P|DIV|LI|TD|TH|BLOCKQUOTE)$/;
const PICKED = "bc-img-picked";
// Empty style attributes and bare spans left behind by restyling are noise in the saved HTML.
const tidy = (el: Element) => [el, ...Array.from(el.querySelectorAll("[style]"))].forEach(n => {
  if (!n.getAttribute("style")?.trim()) n.removeAttribute("style");
  if (n !== el && n.tagName === "SPAN" && !n.attributes.length) n.replaceWith(...Array.from(n.childNodes));
});
const unstyle = (el: Element, props: string[]) => [el, ...Array.from(el.querySelectorAll("[style]"))].forEach(n => props.forEach(p => (n as HTMLElement).style.removeProperty(p)));
export default forwardRef<RichEmailHandle, {value: string; onChange: (value: string) => void; rows: number; placeholder?: string}>(function RichEmailEditor({value, onChange, rows, placeholder}, ref) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const emitted = useRef<string | null>(null);
  // QA row 221: Chrome gives a clicked image no selection, so it is tracked here and outlined.
  const picked = useRef<HTMLImageElement | null>(null);
  const linkEl = useRef<HTMLAnchorElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [hasLink, setHasLink] = useState(false);
  const [onImage, setOnImage] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [linkError, setLinkError] = useState("");
  // QA row 169: pasted formatting is kept (sanitised) unless she switches it off or uses Ctrl+Shift+V.
  const { keepFormatting, setKeepFormatting } = usePastePreference();
  const plainShortcutAt = useRef(0);
  useEffect(() => { if (root.current && value !== emitted.current) { root.current.innerHTML = emailHtml(value); picked.current = null; } }, [value]);
  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && root.current?.contains(s.anchorNode) && root.current.contains(s.focusNode)) selection.current = s.getRangeAt(0).cloneRange();
  };
  const select = (r: Range) => { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); selection.current = r.cloneRange(); };
  const unpick = () => { picked.current?.classList.remove(PICKED); picked.current = null; };
  const pickedImage = () => picked.current && root.current?.contains(picked.current) ? picked.current : null;
  const restore = () => {
    const el = root.current;
    if (!el) return;
    el.focus();
    const s = window.getSelection();
    if (!s) return;
    const r = selection.current;
    s.removeAllRanges();
    if (r && el.contains(r.commonAncestorContainer)) s.addRange(r);
    else { const end = document.createRange(); end.selectNodeContents(el); end.collapse(false); s.addRange(end); }
  };
  const change = () => {
    if (!root.current) return;
    emitted.current = RICH_EMAIL + safeEmailHtml(root.current.innerHTML);
    onChange(emitted.current); remember();
  };
  const blockOf = (node: Node | null) => {
    for (let n = node instanceof Element ? node : node?.parentElement; n && n !== root.current; n = n.parentElement) if (BLOCK.test(n.tagName)) return n;
    return null;
  };
  const insert = (html: string) => { restore(); document.execCommand("insertHTML", false, safeEmailHtml(html)); change(); };
  const insertPlain = (text: string) => { restore(); document.execCommand("insertText", false, text); change(); };
  const pastePlain = () => { remember(); void readClipboardText().then(text => { if (text) insertPlain(text); }); };
  const linkAround = () => {
    const img = pickedImage();
    if (img) return img.closest("a");
    const r = selection.current, el = root.current;
    const a = r && (r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement)?.closest("a");
    return a && el?.contains(a) && a.contains(r.endContainer) ? a : null;
  };
  const applyLink = () => {
    const url = linkUrl.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url)) { setLinkError("Enter a complete web or email address."); return; }
    restore();
    const img = pickedImage(), a = linkEl.current && root.current?.contains(linkEl.current) ? linkEl.current : null;
    if (a) { a.href = url; change(); }
    else if (img) {
      const wrap = document.createElement("a"); wrap.href = url;
      img.replaceWith(wrap); wrap.appendChild(img); change();
    } else if (!window.getSelection()?.toString()) {
      const link = document.createElement("a"); link.href = url; link.textContent = url; insert(link.outerHTML);
    } else { document.execCommand("createLink", false, url); change(); }
    setLinkOpen(false);
  };
  const removeLink = () => {
    const a = linkEl.current;
    restore();
    if (a && root.current?.contains(a)) { a.replaceWith(...Array.from(a.childNodes)); change(); }
    setLinkOpen(false);
  };
  const heading = () => {
    const s = window.getSelection(), r = s?.rangeCount ? s.getRangeAt(0) : null;
    if (!r) return;
    const on = /^H[1-4]$/.test(blockOf(r.startContainer)?.tagName || "");
    document.execCommand("formatBlock", false, on ? "<p>" : "<h2>");
    // Kajabi imports carry font-size on inner spans, which would hide the heading's own size.
    const after = s?.rangeCount ? s.getRangeAt(0) : null;
    if (!on && after && root.current) root.current.querySelectorAll("h2").forEach(h => { if (after.intersectsNode(h)) { unstyle(h, ["font-size", "font-weight", "line-height"]); tidy(h); } });
  };
  const font = (prop: "font-size" | "font-family", value: string) => {
    const el = root.current;
    if (!el) return;
    restore();
    const s = window.getSelection();
    if (!s?.rangeCount) return;
    // A bare cursor restyles the whole paragraph it sits in.
    if (s.getRangeAt(0).collapsed) { const r = document.createRange(); r.selectNodeContents(blockOf(s.anchorNode) || el); select(r); }
    document.execCommand("styleWithCSS", false, "false");
    // <font> is a marker only: it is swapped for a styled span straight away (the sanitiser drops <font>).
    document.execCommand(prop === "font-size" ? "fontSize" : "fontName", false, prop === "font-size" ? "7" : value);
    const spans = Array.from(el.querySelectorAll("font")).map(f => {
      const span = document.createElement("span");
      unstyle(f, [prop]);
      span.style.setProperty(prop, value);
      span.append(...Array.from(f.childNodes)); f.replaceWith(span);
      return span;
    });
    tidy(el);
    if (spans.length) { const r = document.createRange(); r.setStartBefore(spans[0]); r.setEndAfter(spans[spans.length - 1]); select(r); }
    change();
  };
  useImperativeHandle(ref, () => ({
    insert,
    insertText: text => { restore(); document.execCommand("insertText", false, text); change(); },
    font,
    format: id => {
      restore();
      if (id === "link") {
        remember();
        linkEl.current = linkAround();
        setHasLink(!!linkEl.current); setOnImage(!!pickedImage());
        setLinkUrl(linkEl.current?.getAttribute("href") || "https://"); setLinkError(""); setLinkOpen(true);
      } else if (id === "heading") { heading(); change(); }
      else {
        const commands: Record<string, string> = {bold:"bold",italic:"italic",bullets:"insertUnorderedList",numbers:"insertOrderedList"};
        document.execCommand(commands[id] || id, false); change();
      }
    },
  }));
  return <>
    {linkOpen && <div role="dialog" aria-label="Add a hyperlink" className="rounded-xl border border-hairline bg-white p-4 text-slate-900">
      <label className="block text-sm font-semibold">Link address<input autoFocus type="url" className="mt-2 block w-full rounded border bg-white p-2 text-slate-900" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => {if(e.key === "Enter"){e.preventDefault();applyLink();} if(e.key === "Escape"){e.preventDefault();setLinkOpen(false);}}} /></label>
      {onImage && <p className="mt-2 text-xs text-slate-600">This link goes on the selected image.</p>}
      {linkError && <p role="alert" className="mt-2 text-red-700">{linkError}</p>}
      <div className="mt-3 flex gap-3"><button type="button" className="rounded bg-[#58234e] px-4 py-2 text-white" onClick={applyLink}>{hasLink ? "Update link" : "Insert link"}</button>{hasLink && <button type="button" className="rounded border px-4 py-2" onClick={removeLink}>Remove link</button>}<button type="button" className="rounded border px-4 py-2" onClick={() => {setLinkOpen(false);restore();}}>Cancel</button></div>
    </div>}
    <style>{`.bc-email-editor{background:#fff;color:#24222a;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere}.bc-email-editor strong,.bc-email-editor b{color:inherit;font-weight:700}.bc-email-editor a{color:#58234e;text-decoration:underline}.bc-email-editor img{max-width:100%;height:auto;cursor:pointer}.bc-email-editor img.${PICKED}{outline:3px solid #58234e;outline-offset:2px}.bc-email-editor p{margin:0 0 16px}.bc-email-editor ul{list-style:disc;padding-left:24px}.bc-email-editor ol{list-style:decimal;padding-left:24px}.bc-email-editor h2{font-size:24px;font-weight:700;line-height:1.25;margin:0 0 12px}.bc-email-editor:empty:before{content:attr(data-placeholder);color:#737078;pointer-events:none}`}</style>
    <div ref={root} role="textbox" aria-label="Email message" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder={placeholder || "Write or paste your formatted email here…"} className="bc-email-editor rounded-xl border border-hairline p-4 focus:outline-plum" style={{minHeight:Math.max(rows * 24, 240)}} onInput={change} onKeyDown={event => { unpick(); if (isPlainPasteShortcut(event)) plainShortcutAt.current = Date.now(); }} onKeyUp={remember} onMouseUp={remember} onBlur={remember} onClick={event => {
      const img = event.target instanceof HTMLImageElement ? event.target : null;
      unpick();
      if (!img) return;
      picked.current = img; img.classList.add(PICKED);
      const r = document.createRange(); r.selectNode(img); select(r);
    }} onPaste={event => {
      event.preventDefault(); remember();
      const plain = !keepFormatting || Date.now() - plainShortcutAt.current < 1500;
      plainShortcutAt.current = 0;
      const html = event.clipboardData.getData("text/html");
      if (html && !plain) insert(html);
      else insertPlain(event.clipboardData.getData("text/plain"));
    }} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-ink-soft">Select words to format or link them (font and size apply to the selection, or to the whole paragraph if nothing is selected). Click an image, then Add a link, to make it clickable.</p>
      <PasteOptions keepFormatting={keepFormatting} setKeepFormatting={setKeepFormatting} onPastePlain={pastePlain} />
    </div>
  </>;
});

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { emailHtml, RICH_EMAIL, safeEmailHtml } from "./emailMarkup";
import { isPlainPasteShortcut, PasteOptions, readClipboardText, usePastePreference } from "./smartPaste";
export interface RichEmailHandle {
  format: (id: string) => void;
  insert: (html: string) => void;
  insertText: (text: string) => void;
}
export default forwardRef<RichEmailHandle, {value: string; onChange: (value: string) => void; rows: number; placeholder?: string}>(function RichEmailEditor({value, onChange, rows, placeholder}, ref) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const emitted = useRef<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [linkError, setLinkError] = useState("");
  // QA row 169: pasted formatting is kept (sanitised) unless she switches it off or uses Ctrl+Shift+V.
  const { keepFormatting, setKeepFormatting } = usePastePreference();
  const plainShortcutAt = useRef(0);
  useEffect(() => { if (root.current && value !== emitted.current) root.current.innerHTML = emailHtml(value); }, [value]);
  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && root.current?.contains(s.anchorNode) && root.current.contains(s.focusNode)) selection.current = s.getRangeAt(0).cloneRange();
  };
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
  const insert = (html: string) => { restore(); document.execCommand("insertHTML", false, safeEmailHtml(html)); change(); };
  const insertPlain = (text: string) => { restore(); document.execCommand("insertText", false, text); change(); };
  const pastePlain = () => { remember(); void readClipboardText().then(text => { if (text) insertPlain(text); }); };
  const applyLink = () => {
    const url = linkUrl.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url)) { setLinkError("Enter a complete web or email address."); return; }
    restore();
    if (!window.getSelection()?.toString()) {
      const a = document.createElement("a"); a.href = url; a.textContent = url; insert(a.outerHTML);
    } else { document.execCommand("createLink", false, url); change(); }
    setLinkOpen(false);
  };
  useImperativeHandle(ref, () => ({
    insert,
    insertText: text => { restore(); document.execCommand("insertText", false, text); change(); },
    format: id => {
      restore();
      if (id === "link") {
        remember();
        setLinkUrl("https://"); setLinkError(""); setLinkOpen(true);
      } else {
        const commands: Record<string, string> = {bold:"bold",italic:"italic",bullets:"insertUnorderedList",numbers:"insertOrderedList",heading:"formatBlock"};
        document.execCommand(commands[id] || id, false, id === "heading" ? "h2" : undefined); change();
      }
    },
  }));
  return <>
    {linkOpen && <div role="dialog" aria-label="Add a hyperlink" className="rounded-xl border border-hairline bg-white p-4 text-slate-900">
      <label className="block text-sm font-semibold">Link address<input autoFocus type="url" className="mt-2 block w-full rounded border bg-white p-2 text-slate-900" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => {if(e.key === "Enter"){e.preventDefault();applyLink();} if(e.key === "Escape"){e.preventDefault();setLinkOpen(false);}}} /></label>
      {linkError && <p role="alert" className="mt-2 text-red-700">{linkError}</p>}
      <div className="mt-3 flex gap-3"><button type="button" className="rounded bg-[#58234e] px-4 py-2 text-white" onClick={applyLink}>Insert link</button><button type="button" className="rounded border px-4 py-2" onClick={() => {setLinkOpen(false);restore();}}>Cancel</button></div>
    </div>}
    <style>{`.bc-email-editor{background:#fff;color:#24222a;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere}.bc-email-editor strong,.bc-email-editor b{color:inherit;font-weight:700}.bc-email-editor a{color:#58234e;text-decoration:underline}.bc-email-editor img{max-width:100%;height:auto}.bc-email-editor p{margin:0 0 16px}.bc-email-editor ul{list-style:disc;padding-left:24px}.bc-email-editor ol{list-style:decimal;padding-left:24px}.bc-email-editor h2{font-size:24px;font-weight:700}.bc-email-editor:empty:before{content:attr(data-placeholder);color:#737078;pointer-events:none}`}</style>
    <div ref={root} role="textbox" aria-label="Email message" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder={placeholder || "Write or paste your formatted email here…"} className="bc-email-editor rounded-xl border border-hairline p-4 focus:outline-plum" style={{minHeight:Math.max(rows * 24, 240)}} onInput={change} onKeyDown={event => { if (isPlainPasteShortcut(event)) plainShortcutAt.current = Date.now(); }} onKeyUp={remember} onMouseUp={remember} onBlur={remember} onPaste={event => {
      event.preventDefault(); remember();
      const plain = !keepFormatting || Date.now() - plainShortcutAt.current < 1500;
      plainShortcutAt.current = 0;
      const html = event.clipboardData.getData("text/html");
      if (html && !plain) insert(html);
      else insertPlain(event.clipboardData.getData("text/plain"));
    }} />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-ink-soft">Paste formatted text, select words to format or link them, and use Image / GIF to insert media.</p>
      <PasteOptions keepFormatting={keepFormatting} setKeepFormatting={setKeepFormatting} onPastePlain={pastePlain} />
    </div>
  </>;
});

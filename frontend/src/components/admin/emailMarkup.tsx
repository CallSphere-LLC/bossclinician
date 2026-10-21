import DOMPurify from "dompurify";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const RICH_EMAIL = "<!--bc:rich-email-->";
export const emailStyles = `body{margin:0;padding:24px;background:#fff;color:#24222a;font:16px/1.6 Arial,sans-serif;overflow-wrap:anywhere}p{margin:0 0 16px}a{color:#58234e;text-decoration:underline}strong,b{color:inherit;font-weight:700}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}blockquote{border-left:3px solid #ddd;padding-left:16px}h1,h2,h3{line-height:1.25;color:inherit}li{margin:4px 0}`;
export function safeEmailHtml(html: string): string {
  // SSR never installs HTML into an editable DOM. The preview frame also has
  // a restrictive CSP and no sandbox permissions, including no script access.
  if (typeof window === "undefined") return "";
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p","div","span","br","strong","b","em","i","u","s","h1","h2","h3","h4","ul","ol","li","a","img","hr","blockquote","table","tbody","thead","tr","td","th"],
    ALLOWED_ATTR: ["href","src","alt","title","style","width","height","colspan","rowspan"],
    ALLOW_DATA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.body.querySelectorAll("*").forEach(el => {
    for (const attr of ["href", "src"]) {
      const url = el.getAttribute(attr);
      if (url && !(attr === "href" ? /^(https?:\/\/|mailto:)/i : /^https:\/\//i).test(url)) el.removeAttribute(attr);
    }
    const element = el as HTMLElement;
    const allowed = /^(color|background-color|font-weight|font-style|font-size|font-family|text-decoration|text-align|line-height|padding|margin|border|border-radius|width|max-width|height)$/;
    for (const name of Array.from(element.style)) {
      const val = element.style.getPropertyValue(name);
      if (!allowed.test(name) || /url\s*\(|expression|var\s*\(|!important/i.test(val)) element.style.removeProperty(name);
    }
  });
  return doc.body.innerHTML;
}
export function emailHtml(value: string): string {
  if (value.startsWith(RICH_EMAIL) || /<(?:p|div|table|html|body|span)\b/i.test(value)) return safeEmailHtml(value);
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} components={{a: ({title, ...props}) => <a {...props} style={title === "button" ? {display:"inline-block",background:"#5b214e",color:"#fff",padding:"12px 20px",borderRadius:8,textDecoration:"none"} : undefined} />}}>{value}</ReactMarkdown>);
}
export default function EmailBodyPreview({value, title = "Email preview"}: {value: string; title?: string}) {
  return <iframe title={title} sandbox="" className="h-[32rem] w-full rounded-xl border border-hairline bg-white" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${emailStyles}</style></head><body>${emailHtml(value)}</body></html>`} />;
}

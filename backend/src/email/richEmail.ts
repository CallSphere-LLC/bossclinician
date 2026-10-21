import sanitizeHtml from "sanitize-html";

export const RICH_EMAIL = "<!--bc:rich-email-->";
export const isRichEmail = (value: string) => value.startsWith(RICH_EMAIL);
export function sanitizeRichEmail(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: ["p","div","span","br","strong","b","em","i","u","s","h1","h2","h3","h4","ul","ol","li","a","img","hr","blockquote","table","tbody","thead","tr","td","th"],
    allowedAttributes: {"*": ["style"], a:["href","title","style"], img:["src","alt","title","width","height","style"], td:["colspan","rowspan","style"], th:["colspan","rowspan","style"]},
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: {img:["https"]},
    allowProtocolRelative: false,
    allowedStyles: {"*": {
      "color":[/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i],
      "background-color":[/^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i],
      "font-weight":[/^(normal|bold|[1-9]00)$/], "font-style":[/^(normal|italic)$/],
      "font-size":[/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
      "font-family":[/^[a-zA-Z\s,'"-]+$/],
      "text-align":[/^(left|right|center|justify)$/],
      "text-decoration":[/^(none|underline|line-through)( (underline|line-through))?$/],
      "line-height":[/^\d+(\.\d+)?(px|em|%)?$/],
      "padding":[/^[\d.]+(px|em)( [\d.]+(px|em)){0,3}$/],
      "margin":[/^(0|[\d.]+(px|em))( (0|[\d.]+(px|em))){0,3}$/],
      "border-radius":[/^\d+(px|%)$/],
      "width":[/^\d+(px|%)$/], "max-width":[/^\d+(px|%)$/], "height":[/^(auto|\d+px)$/],
    }},
    transformTags: {img: sanitizeHtml.simpleTransform("img", {style:"max-width:100%;height:auto"}, true)},
  });
}
export function richEmailText(value: string): string {
  return sanitizeHtml(sanitizeRichEmail(value).replace(/<\/(?:p|div|h[1-4]|li|tr)>|<br\s*\/?\s*>/gi, "\n"), {allowedTags:[], allowedAttributes:{}})
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").trim();
}

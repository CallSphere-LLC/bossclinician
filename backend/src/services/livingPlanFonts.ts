import path from "node:path";
import { badRequest } from "../utils/httpError";

interface FontFace { hasGlyphForCodePoint(code: number): boolean }
// PDFKit already uses fontkit 2.0.4. Declared directly because this module uses
// its coverage API rather than depending on PDFKit's private internals.
const { openSync } = require("fontkit") as { openSync: (filename: string) => FontFace };

export const PLAN_FONT_PATHS = {
  NotoSans: path.join(__dirname, "..", "assets", "fonts", "NotoSans-Regular.ttf"),
  NotoEmoji: path.join(__dirname, "..", "assets", "fonts", "NotoEmoji.ttf"),
};
type FallbackFont = keyof typeof PLAN_FONT_PATHS;
const faces = new Map<FallbackFont, FontFace>();
const face = (name: FallbackFont) => {
  if (!faces.has(name)) faces.set(name, openSync(PLAN_FONT_PATHS[name]));
  return faces.get(name)!;
};
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const WIN_ANSI = /^[\t\n\r\u0020-\u007e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]*$/;

/** Keep combining marks and emoji sequences together so font shaping retains
 * names, accents, skin tones and joined emoji. Unsupported scripts fail before
 * rendering, with a browser-print fallback; user text is never stripped.
 */
export function planTextRuns(text: string, baseFont = "Helvetica"): { text: string; font: string }[] {
  if (WIN_ANSI.test(text)) return [{ text, font: baseFont }];
  const runs: { text: string; font: string }[] = [];
  for (const { segment } of graphemes.segment(text)) {
    const codes = [...segment].map((character) => character.codePointAt(0)!);
    const covered = (name: FallbackFont) => codes.every((code) => code === 0x200d || code === 0xfe0e || code === 0xfe0f || face(name).hasGlyphForCodePoint(code));
    const font = WIN_ANSI.test(segment) ? baseFont : covered("NotoSans") ? "NotoSans" : covered("NotoEmoji") ? "NotoEmoji" : null;
    if (!font) throw badRequest("This plan includes a script or symbol not supported by the download fonts. Use Print / Save as PDF to preserve all of your text.");
    if (runs.at(-1)?.font === font) runs[runs.length - 1].text += segment;
    else runs.push({ font, text: segment });
  }
  return runs;
}

export function writePlanText(doc: PDFKit.PDFDocument, text: string, options: PDFKit.Mixins.TextOptions, baseFont = "Helvetica"): void {
  const runs = planTextRuns(text, baseFont);
  runs.forEach((run, index) => {
    if (run.font === "NotoSans" || run.font === "NotoEmoji") doc.registerFont(run.font, PLAN_FONT_PATHS[run.font]);
    doc.font(run.font).text(run.text, { ...options, continued: index < runs.length - 1 });
  });
  doc.font(baseFont);
}

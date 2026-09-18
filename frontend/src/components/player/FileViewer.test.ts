import { describe, expect, it } from "vitest";
import { parseDelimited, viewerKindFor } from "./FileViewer";

describe("viewerKindFor", () => {
  it.each([
    [{ filename: "workbook.pdf", mime: "application/pdf" }, "pdf"],
    [{ filename: "WORKBOOK.PDF", mime: "application/octet-stream" }, "pdf"],
    [{ filename: "plan.docx", mime: "" }, "docx"],
    [{ filename: "rates.csv", mime: "text/csv" }, "table"],
    [{ filename: "rates.tsv", mime: "" }, "table"],
    [{ filename: "cover.webp", mime: "image/webp" }, "image"],
    [{ filename: "intro.mp4", mime: "video/mp4" }, "video"],
    [{ filename: "call.m4a", mime: "" }, "audio"],
    [{ filename: "practice-reset-worksheet.txt", mime: "text/plain" }, "text"],
    [{ filename: "notes.md", mime: "" }, "text"],
    [{ filename: "budget.xlsx", mime: "application/vnd.ms-excel" }, "none"],
    [{ filename: "bundle.zip", mime: "application/zip" }, "none"],
    [{ filename: "no-extension", mime: "" }, "none"],
  ] as const)("%o is shown as %s", (file, expected) => {
    expect(viewerKindFor(file)).toBe(expected);
  });
});

describe("parseDelimited", () => {
  it("keeps commas, quotes and line breaks that sit inside a quoted cell", () => {
    const rows = parseDelimited('name,note\r\n"Howard, Yvette","said ""hello""\nthen left"\n', ",", 10);
    expect(rows).toEqual([
      ["name", "note"],
      ["Howard, Yvette", 'said "hello"\nthen left'],
    ]);
  });

  it("skips blank lines and stops at the row limit", () => {
    expect(parseDelimited("a\n\nb\nc\nd", ",", 2)).toEqual([["a"], ["b"]]);
  });

  it("splits on tabs when asked", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t", 10)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

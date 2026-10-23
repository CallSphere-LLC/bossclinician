import { describe, expect, it } from "vitest";
import { isPlainPasteShortcut } from "./smartPaste";

const key = (over: Partial<{ key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
  key: "v",
  code: "KeyV",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe("isPlainPasteShortcut", () => {
  it("is Ctrl+Shift+V, or Cmd+Shift+V on a Mac", () => {
    expect(isPlainPasteShortcut(key({ ctrlKey: true, shiftKey: true, key: "V" }))).toBe(true);
    expect(isPlainPasteShortcut(key({ metaKey: true, shiftKey: true }))).toBe(true);
  });

  it("matches the physical V key on other keyboard layouts", () => {
    expect(isPlainPasteShortcut(key({ ctrlKey: true, shiftKey: true, key: "м" }))).toBe(true);
  });

  it("leaves an ordinary paste (which keeps formatting) alone", () => {
    expect(isPlainPasteShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isPlainPasteShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isPlainPasteShortcut(key({ ctrlKey: true, shiftKey: true, key: "c", code: "KeyC" }))).toBe(false);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import {
  ENDED_TEXT,
  FRAME_COUNT,
  FRAME_DELAY_CS,
  GIF_HEIGHT,
  GIF_WIDTH,
  MAX_REMAINING_SECONDS,
  OPEN_TEXT,
  PALETTE,
  UNIT_LABELS,
  drawCountdownCanvas,
  drawMessageCanvas,
  hasGlyph,
  lzwEncode,
  normaliseRemaining,
  renderCountdownGif,
  renderMessageGif,
} from "./countdownGif";

/**
 * The encoder is hand-written, so these tests carry their own decoder, written
 * the way a mail client's would be and sharing no code with the encoder. A
 * picture that only the encoder's own idea of the format could read back would
 * prove nothing about whether Gmail or Apple Mail can show it.
 */

/** Textbook GIF LZW decoder: prefix/suffix tables and a stack. */
function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  const out = new Uint8Array(pixelCount);
  let written = 0;
  let width = minCodeSize + 1;
  let next = endCode + 1;
  let previous = -1;
  let bitBuffer = 0;
  let bitCount = 0;
  let at = 0;

  const put = (value: number): void => {
    if (written >= pixelCount) throw new Error("decoded more pixels than the image holds");
    out[written] = value;
    written += 1;
  };

  for (;;) {
    while (bitCount < width) {
      if (at >= data.length) throw new Error("ran out of data before the end code");
      bitBuffer |= data[at] << bitCount;
      at += 1;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << width) - 1);
    bitBuffer >>>= width;
    bitCount -= width;

    if (code === clearCode) {
      width = minCodeSize + 1;
      next = endCode + 1;
      previous = -1;
      continue;
    }
    if (code === endCode) break;

    if (previous === -1) {
      if (code >= clearCode) throw new Error("first code after a clear must be a plain pixel");
      put(code);
      previous = code;
      continue;
    }
    if (code > next) throw new Error(`code ${code} is ahead of the dictionary (${next})`);

    // A code not in the table yet can only be "previous string + its own first pixel".
    let walk = code === next ? previous : code;
    let depth = 0;
    while (walk > endCode) {
      stack[depth] = suffix[walk];
      depth += 1;
      walk = prefix[walk];
    }
    const first = walk;
    put(first);
    while (depth > 0) {
      depth -= 1;
      put(stack[depth]);
    }
    if (code === next) put(first);

    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next += 1;
      if (next === 1 << width && width < 12) width += 1;
    }
    previous = code;
  }

  if (written !== pixelCount) throw new Error(`decoded ${written} pixels, expected ${pixelCount}`);
  return out;
}

interface DecodedFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  delayCs: number;
  disposal: number;
  transparent: boolean;
  localTable: boolean;
  pixels: Uint8Array;
}

interface DecodedGif {
  signature: string;
  width: number;
  height: number;
  palette: number[][];
  frames: DecodedFrame[];
  applicationExtensions: string[];
  endedWithTrailer: boolean;
  bytesAfterTrailer: number;
}

function parseGif(file: Buffer): DecodedGif {
  let at = 0;
  const byte = (): number => {
    if (at >= file.length) throw new Error("unexpected end of file");
    const value = file[at];
    at += 1;
    return value;
  };
  const u16 = (): number => byte() | (byte() << 8);
  const subBlocks = (): Uint8Array => {
    const parts: number[] = [];
    for (;;) {
      const size = byte();
      if (size === 0) break;
      for (let i = 0; i < size; i += 1) parts.push(byte());
    }
    return Uint8Array.from(parts);
  };

  const signature = file.subarray(0, 6).toString("latin1");
  at = 6;
  const width = u16();
  const height = u16();
  const packed = byte();
  byte(); // background colour index
  byte(); // aspect ratio
  const palette: number[][] = [];
  if (packed & 0x80) {
    const entries = 1 << ((packed & 0x07) + 1);
    for (let i = 0; i < entries; i += 1) palette.push([byte(), byte(), byte()]);
  }

  const frames: DecodedFrame[] = [];
  const applicationExtensions: string[] = [];
  let control = { delayCs: 0, disposal: 0, transparent: false };
  let endedWithTrailer = false;

  while (at < file.length) {
    const introducer = byte();
    if (introducer === 0x3b) {
      endedWithTrailer = true;
      break;
    }
    if (introducer === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        expect(byte()).toBe(4);
        const flags = byte();
        const delayCs = u16();
        byte(); // transparent colour index
        expect(byte()).toBe(0);
        control = { delayCs, disposal: (flags >> 2) & 0x07, transparent: (flags & 0x01) === 1 };
      } else if (label === 0xff) {
        applicationExtensions.push(Buffer.from(subBlocks()).toString("latin1"));
      } else {
        subBlocks();
      }
      continue;
    }
    if (introducer !== 0x2c) throw new Error(`unknown block 0x${introducer.toString(16)} at ${at - 1}`);

    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    const flags = byte();
    const localTable = (flags & 0x80) !== 0;
    if (localTable) at += 3 * (1 << ((flags & 0x07) + 1));
    const minCodeSize = byte();
    const pixels = lzwDecode(subBlocks(), minCodeSize, w * h);
    frames.push({ x, y, w, h, ...control, localTable, pixels });
    control = { delayCs: 0, disposal: 0, transparent: false };
  }

  return {
    signature,
    width,
    height,
    palette,
    frames,
    applicationExtensions,
    endedWithTrailer,
    bytesAfterTrailer: file.length - at,
  };
}

/** Plays the frames the way a viewer does: each drawn over the last, nothing cleared. */
function composite(gif: DecodedGif, upTo = gif.frames.length): Uint8Array {
  const screen = new Uint8Array(gif.width * gif.height);
  for (const frame of gif.frames.slice(0, upTo)) {
    expect(frame.x + frame.w).toBeLessThanOrEqual(gif.width);
    expect(frame.y + frame.h).toBeLessThanOrEqual(gif.height);
    for (let row = 0; row < frame.h; row += 1) {
      screen.set(
        frame.pixels.subarray(row * frame.w, (row + 1) * frame.w),
        (frame.y + row) * gif.width + frame.x
      );
    }
  }
  return screen;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

/** A small fixed pseudo-random stream, so the LZW cases are the same on every run. */
function noise(length: number, values: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state >>> 16) % values;
  }
  return out;
}

const DAY = 86400;

describe("lzwEncode", () => {
  it("round-trips a small buffer", () => {
    const pixels = Uint8Array.from([0, 0, 0, 1, 1, 2, 3, 3, 3, 3, 0, 1, 0, 1, 0, 1, 2, 2]);
    expect(same(lzwDecode(lzwEncode(pixels, 2), 2, pixels.length), pixels)).toBe(true);
  });

  it("round-trips a single pixel", () => {
    for (const value of [0, 1, 2, 3]) {
      const pixels = Uint8Array.from([value]);
      expect(same(lzwDecode(lzwEncode(pixels, 2), 2, 1), pixels)).toBe(true);
    }
  });

  it("round-trips every short run length, where the code width changes under the end code", () => {
    // Long runs of one colour hit the "code not in the table yet" case on every
    // step, and sweeping the length walks the final code across each width change.
    for (let length = 1; length <= 400; length += 1) {
      const pixels = new Uint8Array(length).fill(2);
      expect(same(lzwDecode(lzwEncode(pixels, 2), 2, length), pixels)).toBe(true);
    }
    for (let length = 1; length <= 200; length += 1) {
      const pixels = noise(length, 4, length);
      expect(same(lzwDecode(lzwEncode(pixels, 2), 2, length), pixels)).toBe(true);
    }
  });

  it("round-trips data long enough to fill the dictionary and start it again", () => {
    // Random two-bit pixels add a code almost every other pixel: 60,000 of them
    // pass 4,096 codes several times over.
    const pixels = noise(60_000, 4, 7);
    const packed = lzwEncode(pixels, 2);
    expect(same(lzwDecode(packed, 2, pixels.length), pixels)).toBe(true);
  });

  it("round-trips at the full eight-bit code size", () => {
    const pixels = noise(30_000, 256, 11);
    expect(same(lzwDecode(lzwEncode(pixels, 8), 8, pixels.length), pixels)).toBe(true);
  });

  it("shrinks a flat picture a great deal", () => {
    const flat = new Uint8Array(GIF_WIDTH * GIF_HEIGHT);
    const packed = lzwEncode(flat, 2);
    expect(packed.length).toBeLessThan(1500);
    expect(same(lzwDecode(packed, 2, flat.length), flat)).toBe(true);
  });

  it("refuses sizes the format does not define", () => {
    expect(() => lzwEncode(Uint8Array.from([0]), 1)).toThrow();
    expect(() => lzwEncode(Uint8Array.from([0]), 9)).toThrow();
    expect(() => lzwEncode(new Uint8Array(0), 2)).toThrow();
  });
});

describe("the font", () => {
  it("has a shape for every character it is asked to draw", () => {
    for (const text of [...UNIT_LABELS, ENDED_TEXT, OPEN_TEXT, "0123456789"]) {
      for (const ch of text) expect(hasGlyph(ch), `missing "${ch}" in "${text}"`).toBe(true);
    }
  });

  it("draws ten different digits", () => {
    const seen = new Set<string>();
    for (let digit = 0; digit <= 9; digit += 1) {
      seen.add(Buffer.from(drawCountdownCanvas(10 + digit)).toString("base64"));
    }
    expect(seen.size).toBe(10);
  });
});

describe("renderCountdownGif", () => {
  const remaining = 3 * DAY + 4 * 3600 + 5 * 60 + 6;
  let file: Buffer;
  let gif: DecodedGif;

  // In a hook, not at describe level: a fault in the encoder then fails these
  // tests by name instead of stopping the whole file from being collected.
  beforeAll(() => {
    file = renderCountdownGif(remaining);
    gif = parseGif(file);
  });

  it("is a GIF89a file with the brand palette and a trailer", () => {
    expect(file.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(file[file.length - 1]).toBe(0x3b);
    expect(gif.signature).toBe("GIF89a");
    expect(gif.width).toBe(GIF_WIDTH);
    expect(gif.height).toBe(GIF_HEIGHT);
    expect(gif.palette).toEqual(PALETTE.map((rgb) => [...rgb]));
    expect(gif.palette[0]).toEqual([0x1e, 0x16, 0x30]);
    expect(gif.palette[1]).toEqual([0xc9, 0xa4, 0x5c]);
    expect(gif.endedWithTrailer).toBe(true);
    expect(gif.bytesAfterTrailer).toBe(0);
  });

  it("holds sixty frames of one second each", () => {
    expect(gif.frames).toHaveLength(FRAME_COUNT);
    expect(FRAME_COUNT).toBe(60);
    for (const frame of gif.frames) {
      expect(frame.delayCs).toBe(FRAME_DELAY_CS);
      expect(frame.disposal).toBe(1);
      expect(frame.transparent).toBe(false);
      expect(frame.localTable).toBe(false);
      expect(frame.w).toBeGreaterThan(0);
      expect(frame.h).toBeGreaterThan(0);
    }
  });

  it("does not loop, so it never shows a stale time again", () => {
    expect(gif.applicationExtensions).toEqual([]);
    expect(file.includes("NETSCAPE")).toBe(false);
  });

  it("makes the first frame the whole picture, for clients that show only that", () => {
    const first = gif.frames[0];
    expect([first.x, first.y, first.w, first.h]).toEqual([0, 0, GIF_WIDTH, GIF_HEIGHT]);
    expect(same(first.pixels, drawCountdownCanvas(remaining))).toBe(true);
  });

  it("sends only what changed after that", () => {
    for (const frame of gif.frames.slice(1)) {
      expect(frame.w * frame.h).toBeLessThan((GIF_WIDTH * GIF_HEIGHT) / 4);
    }
  });

  it("shows the right time at every second when played", () => {
    for (let shown = 1; shown <= FRAME_COUNT; shown += 1) {
      const expected = drawCountdownCanvas(remaining - (shown - 1));
      expect(same(composite(gif, shown), expected), `frame ${shown}`).toBe(true);
    }
  });

  it("is the same bytes for the same input", () => {
    expect(renderCountdownGif(remaining).equals(file)).toBe(true);
    expect(renderCountdownGif(remaining - 1).equals(file)).toBe(false);
  });

  it("stays small enough for an email image", () => {
    expect(file.length).toBeLessThan(60_000);
  });

  it("draws quickly", () => {
    renderCountdownGif(remaining); // warm
    const started = performance.now();
    for (let i = 0; i < 5; i += 1) renderCountdownGif(remaining - i);
    // The target is well under 100 ms each; the bound is loose so a busy CI box cannot fail it.
    expect((performance.now() - started) / 5).toBeLessThan(400);
  });

  it("plays correctly across a minute, an hour and a day turning over", () => {
    for (const start of [2 * 60 + 20, 3600 + 30, DAY + 10, 5 * DAY + 3600]) {
      const played = parseGif(renderCountdownGif(start));
      expect(played.frames).toHaveLength(FRAME_COUNT);
      expect(same(composite(played), drawCountdownCanvas(start - 59)), `from ${start}`).toBe(true);
    }
  });

  it("plays correctly when the days drop from three digits to two", () => {
    const start = 100 * DAY + 5;
    const played = parseGif(renderCountdownGif(start));
    expect(same(played.frames[0].pixels, drawCountdownCanvas(start))).toBe(true);
    expect(same(composite(played), drawCountdownCanvas(start - 59))).toBe(true);
    // The two layouts really are different pictures.
    expect(same(drawCountdownCanvas(100 * DAY), drawCountdownCanvas(99 * DAY))).toBe(false);
  });

  it("caps at 999 days rather than drawing a fourth digit", () => {
    expect(normaliseRemaining(5000 * DAY)).toBe(MAX_REMAINING_SECONDS);
    expect(renderCountdownGif(5000 * DAY).equals(renderCountdownGif(MAX_REMAINING_SECONDS))).toBe(true);
    expect(same(drawCountdownCanvas(Infinity), drawCountdownCanvas(MAX_REMAINING_SECONDS))).toBe(true);
  });

  it("ends on the ended message when the deadline arrives mid-play", () => {
    const played = parseGif(renderCountdownGif(30));
    expect(played.frames).toHaveLength(FRAME_COUNT);
    expect(same(played.frames[0].pixels, drawCountdownCanvas(30))).toBe(true);
    expect(same(composite(played, 30), drawCountdownCanvas(1))).toBe(true);
    expect(same(composite(played, 31), drawMessageCanvas(ENDED_TEXT))).toBe(true);
    expect(same(composite(played), drawMessageCanvas(ENDED_TEXT))).toBe(true);
    // Nothing changes once it has ended, but each second still has its frame.
    for (const frame of played.frames.slice(31)) expect([frame.w, frame.h]).toEqual([1, 1]);
  });

  it("honours a shorter frame count", () => {
    expect(parseGif(renderCountdownGif(500, { frames: 3 })).frames).toHaveLength(3);
    expect(parseGif(renderCountdownGif(500, { frames: 0 })).frames).toHaveLength(1);
  });
});

describe("after the deadline", () => {
  it("is one still frame saying the offer has ended", () => {
    for (const remaining of [0, -1, -86_400, Number.NaN, -Infinity]) {
      const gif = parseGif(renderCountdownGif(remaining));
      expect(gif.frames).toHaveLength(1);
      expect(gif.endedWithTrailer).toBe(true);
      const [frame] = gif.frames;
      expect([frame.x, frame.y, frame.w, frame.h]).toEqual([0, 0, GIF_WIDTH, GIF_HEIGHT]);
      expect(same(frame.pixels, drawMessageCanvas(ENDED_TEXT))).toBe(true);
    }
  });

  it("is the same file every time, and not a blank one", () => {
    const ended = renderCountdownGif(0);
    expect(ended.equals(renderCountdownGif(-5))).toBe(true);
    expect(ended.equals(renderMessageGif(ENDED_TEXT))).toBe(true);
    const lit = drawMessageCanvas(ENDED_TEXT).filter((p) => p === 2).length;
    expect(lit).toBeGreaterThan(2000);
    expect(ended.length).toBeLessThan(10_000);
  });

  it("hands out a copy, so one caller cannot spoil the next one's picture", () => {
    const first = renderCountdownGif(0);
    first.fill(0);
    expect(renderCountdownGif(0).subarray(0, 6).toString("latin1")).toBe("GIF89a");
    const canvas = drawMessageCanvas(ENDED_TEXT);
    canvas.fill(3);
    expect(drawMessageCanvas(ENDED_TEXT).includes(0)).toBe(true);
  });

  it("has a different still for an offer with no deadline", () => {
    const open = parseGif(renderMessageGif(OPEN_TEXT));
    expect(open.frames).toHaveLength(1);
    expect(same(open.frames[0].pixels, drawMessageCanvas(ENDED_TEXT))).toBe(false);
  });
});

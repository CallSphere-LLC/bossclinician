/**
 * The email countdown timer: an animated GIF drawn and encoded here, with no
 * image library and no native code (sheet row 250, COUNTDOWN.md).
 *
 * An email cannot run a script, so the only clock it can show is a picture that
 * moves. Each open fetches a fresh GIF whose first frame is the time left at
 * that moment and whose next 59 frames count down one second apiece.
 *
 * Three decisions worth knowing before changing anything:
 *
 *  - There is NO looping extension. A GIF without one plays once and holds its
 *    last frame, which is what we want: looping would jump back to a time that
 *    was already a minute stale.
 *  - Frame 1 is always the whole picture. Outlook on Windows shows only the
 *    first frame, so it has to stand on its own.
 *  - Frames 2 onward carry only the rectangle of pixels that changed, drawn
 *    over what is already there (disposal "leave in place", no transparency).
 *    That is the difference between about 15 KB and about 150 KB per open.
 *
 * Everything in this file is pure: same input, same bytes, no clock, no I/O.
 */

export const GIF_WIDTH = 600;
export const GIF_HEIGHT = 120;
export const FRAME_COUNT = 60;
/** Hundredths of a second, the unit the format counts frame delays in. */
export const FRAME_DELAY_CS = 100;

export const ENDED_TEXT = "THIS OFFER HAS ENDED";
/** Shown for an offer that is on sale with no deadline set (nothing to count). */
export const OPEN_TEXT = "OFFER AVAILABLE NOW";
export const UNIT_LABELS = ["DAYS", "HOURS", "MINUTES", "SECONDS"] as const;

/** Days are drawn with at most three digits, so the picture tops out here. */
export const MAX_REMAINING_SECONDS = 1000 * 86400 - 1;

/**
 * The global colour table. Four entries, because the format wants a power of
 * two and two bits per pixel is the smallest size LZW is defined for.
 */
export const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0x1e, 0x16, 0x30], // 0 deep aubergine: background
  [0xc9, 0xa4, 0x5c], // 1 gold: labels, separators, rules
  [0xf7, 0xf1, 0xe3], // 2 ivory: digits and messages
  [0x3a, 0x2d, 0x57], // 3 lifted aubergine: reserved, keeps the table a power of two
];
const BG = 0;
const GOLD = 1;
const IVORY = 2;
/** log2 of the palette size; also the LZW minimum code size. */
const PALETTE_BITS = 2;

/* ------------------------------------------------------------------------ *
 * Font: 5 x 7 cells, scaled up by whole numbers when drawn.
 * ------------------------------------------------------------------------ */

const GLYPH_W = 5;
const GLYPH_H = 7;

const GLYPH_ROWS: Record<string, string[]> = {
  "0": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

/**
 * Each glyph as the list of its lit cells, worked out once at load so drawing
 * is a handful of rectangle fills and never touches a string.
 */
const GLYPHS: Map<string, ReadonlyArray<readonly [number, number]>> = new Map(
  Object.entries(GLYPH_ROWS).map(([ch, rows]) => {
    const cells: Array<readonly [number, number]> = [];
    for (let y = 0; y < GLYPH_H; y += 1) {
      for (let x = 0; x < GLYPH_W; x += 1) {
        if (rows[y]?.charAt(x) === "1") cells.push([x, y]);
      }
    }
    return [ch, cells] as const;
  })
);

/** True when the built-in font can draw this character (a space always can). */
export function hasGlyph(ch: string): boolean {
  return ch === " " || GLYPHS.has(ch);
}

/* ------------------------------------------------------------------------ *
 * Drawing onto a palette-indexed canvas (one byte per pixel).
 * ------------------------------------------------------------------------ */

const PIXELS = GIF_WIDTH * GIF_HEIGHT;

function fillRect(canvas: Uint8Array, x: number, y: number, w: number, h: number, color: number): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(GIF_WIDTH, x + w);
  const y1 = Math.min(GIF_HEIGHT, y + h);
  if (x1 <= x0) return;
  for (let row = y0; row < y1; row += 1) {
    const start = row * GIF_WIDTH;
    canvas.fill(color, start + x0, start + x1);
  }
}

function drawGlyph(canvas: Uint8Array, ch: string, x: number, y: number, scale: number, color: number): void {
  const cells = GLYPHS.get(ch);
  if (!cells) return; // a space, or a character the font has no shape for
  for (const [cx, cy] of cells) fillRect(canvas, x + cx * scale, y + cy * scale, scale, scale, color);
}

/** Letters sit one font cell apart. */
function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : text.length * GLYPH_W * scale + (text.length - 1) * scale;
}

function drawText(canvas: Uint8Array, text: string, x: number, y: number, scale: number, color: number): void {
  const advance = (GLYPH_W + 1) * scale;
  for (let i = 0; i < text.length; i += 1) drawGlyph(canvas, text.charAt(i), x + i * advance, y, scale, color);
}

/** Background plus the two thin gold rules every frame shares. */
function blankCanvas(): Uint8Array {
  const canvas = new Uint8Array(PIXELS); // zero-filled, and BG is index 0
  fillRect(canvas, 24, 6, GIF_WIDTH - 48, 2, GOLD);
  fillRect(canvas, 24, GIF_HEIGHT - 8, GIF_WIDTH - 48, 2, GOLD);
  return canvas;
}

/* ---- the countdown layout ---- */

const DIGIT_SCALE = 7;
const DIGIT_W = GLYPH_W * DIGIT_SCALE; // 35
const DIGIT_GAP = DIGIT_SCALE; // 7
const DIGITS_Y = 22;
const GROUP_GAP = 30;
const LABEL_SCALE = 2;
const LABEL_Y = 84;

interface Layout {
  /** Left edge of each of the four digit groups. */
  groupX: number[];
  /** How many digits each group shows. */
  digits: number[];
}

const groupWidth = (digits: number): number => digits * DIGIT_W + (digits - 1) * DIGIT_GAP;

function layoutFor(dayDigits: number): Layout {
  const digits = [dayDigits, 2, 2, 2];
  const total = digits.reduce((sum, n) => sum + groupWidth(n), 0) + GROUP_GAP * 3;
  let x = Math.floor((GIF_WIDTH - total) / 2);
  const groupX: number[] = [];
  for (const n of digits) {
    groupX.push(x);
    x += groupWidth(n) + GROUP_GAP;
  }
  return { groupX, digits };
}

/** Everything but the digits: the same for every second with this many day digits. */
const baseCanvases = new Map<number, { layout: Layout; canvas: Uint8Array }>();

function baseFor(dayDigits: number): { layout: Layout; canvas: Uint8Array } {
  const cached = baseCanvases.get(dayDigits);
  if (cached) return cached;
  const layout = layoutFor(dayDigits);
  const canvas = blankCanvas();
  for (let g = 0; g < 4; g += 1) {
    const width = groupWidth(layout.digits[g]);
    const label = UNIT_LABELS[g];
    const labelX = layout.groupX[g] + Math.floor((width - textWidth(label, LABEL_SCALE)) / 2);
    drawText(canvas, label, labelX, LABEL_Y, LABEL_SCALE, GOLD);
    if (g < 3) {
      // The separator: two square dots centred in the gap after this group.
      const dotX = layout.groupX[g] + width + Math.floor((GROUP_GAP - DIGIT_SCALE) / 2);
      fillRect(canvas, dotX, DIGITS_Y + 2 * DIGIT_SCALE, DIGIT_SCALE, DIGIT_SCALE, GOLD);
      fillRect(canvas, dotX, DIGITS_Y + 4 * DIGIT_SCALE, DIGIT_SCALE, DIGIT_SCALE, GOLD);
    }
  }
  const made = { layout, canvas };
  baseCanvases.set(dayDigits, made);
  return made;
}

/** Whole seconds, never negative, never NaN, never past what three day digits can show. */
export function normaliseRemaining(remainingSeconds: number): number {
  if (!Number.isFinite(remainingSeconds)) return remainingSeconds === Infinity ? MAX_REMAINING_SECONDS : 0;
  return Math.min(MAX_REMAINING_SECONDS, Math.max(0, Math.floor(remainingSeconds)));
}

/** Paints the countdown for `seconds` (already normalised, above zero) into `target`. */
function paintCountdown(target: Uint8Array, seconds: number): void {
  const days = Math.floor(seconds / 86400);
  const values = [
    days,
    Math.floor((seconds % 86400) / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ];
  const { layout, canvas } = baseFor(days >= 100 ? 3 : 2);
  target.set(canvas);
  for (let g = 0; g < 4; g += 1) {
    const count = layout.digits[g];
    let value = values[g];
    // Right to left, so the value is peeled a digit at a time with no string.
    for (let d = count - 1; d >= 0; d -= 1) {
      const digit = String.fromCharCode(48 + (value % 10));
      value = Math.floor(value / 10);
      drawGlyph(target, digit, layout.groupX[g] + d * (DIGIT_W + DIGIT_GAP), DIGITS_Y, DIGIT_SCALE, IVORY);
    }
  }
}

const messageCanvases = new Map<string, Uint8Array>();

function messageCanvas(text: string): Uint8Array {
  const cached = messageCanvases.get(text);
  if (cached) return cached;
  const canvas = blankCanvas();
  // The largest of three sizes that leaves a margin either side.
  const scale = [4, 3, 2].find((s) => textWidth(text, s) <= GIF_WIDTH - 40) ?? 1;
  const x = Math.floor((GIF_WIDTH - textWidth(text, scale)) / 2);
  const y = Math.floor((GIF_HEIGHT - GLYPH_H * scale) / 2);
  drawText(canvas, text, x, y, scale, IVORY);
  // Only the two fixed messages are kept; anything else is drawn fresh.
  if (text === ENDED_TEXT || text === OPEN_TEXT) messageCanvases.set(text, canvas);
  return canvas;
}

/**
 * The picture for a given number of seconds left, as palette indexes, one byte
 * per pixel, row by row. Zero or less is the "ended" message. A fresh copy, so
 * the caller may keep or change it. Exported for the tests, which compare what
 * a decoder rebuilds from the GIF against this.
 */
export function drawCountdownCanvas(remainingSeconds: number): Uint8Array {
  const seconds = normaliseRemaining(remainingSeconds);
  if (seconds <= 0) return drawMessageCanvas(ENDED_TEXT);
  const canvas = new Uint8Array(PIXELS);
  paintCountdown(canvas, seconds);
  return canvas;
}

/** A one-line message centred on the brand background. Uppercase letters, digits and spaces. */
export function drawMessageCanvas(text: string): Uint8Array {
  return Uint8Array.from(messageCanvas(text.toUpperCase()));
}

/* ------------------------------------------------------------------------ *
 * LZW, the variable-width flavour GIF uses.
 * ------------------------------------------------------------------------ */

const MAX_CODES = 4096;
/** One lookup table per code size, reused between calls: (prefix code, next pixel) -> code. */
const lzwTables = new Map<number, Int16Array>();

/**
 * Compresses palette indexes into GIF's LZW code stream (the bytes that go
 * inside the image's data sub-blocks, without the sub-block framing).
 *
 * Codes are packed least significant bit first. The stream opens with a clear
 * code and closes with end-of-information; when all 4096 codes are taken it
 * emits a clear and starts the dictionary again.
 */
export function lzwEncode(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  if (!Number.isInteger(minCodeSize) || minCodeSize < 2 || minCodeSize > 8) {
    throw new Error("LZW minimum code size must be between 2 and 8");
  }
  const count = pixels.length;
  if (count === 0) throw new Error("LZW needs at least one pixel");

  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const pixelMask = clearCode - 1;

  let table = lzwTables.get(minCodeSize);
  if (!table) {
    table = new Int16Array(MAX_CODES << minCodeSize);
    lzwTables.set(minCodeSize, table);
  }
  table.fill(-1);

  // At most one code of at most 12 bits per pixel, plus the occasional clear.
  const out = new Uint8Array(count * 2 + 16);
  let outLen = 0;
  let bitBuffer = 0;
  let bitCount = 0;
  let width = minCodeSize + 1;
  let nextCode = endCode + 1;

  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      out[outLen] = bitBuffer & 0xff;
      outLen += 1;
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let prefix = pixels[0] & pixelMask;
  for (let i = 1; i < count; i += 1) {
    const pixel = pixels[i] & pixelMask;
    const key = (prefix << minCodeSize) | pixel;
    const known = table[key];
    if (known !== -1) {
      prefix = known;
      continue;
    }
    emit(prefix);
    if (nextCode < MAX_CODES) {
      table[key] = nextCode;
      nextCode += 1;
      // The code just handed out is the first that needs one more bit, and the
      // decoder (which is always one entry behind) widens at this same point.
      if (nextCode > 1 << width && width < 12) width += 1;
    } else {
      emit(clearCode);
      table.fill(-1);
      nextCode = endCode + 1;
      width = minCodeSize + 1;
    }
    prefix = pixel;
  }
  emit(prefix);
  // The decoder adds one more entry after reading that last code, and widens
  // if that entry fills the current width. We add nothing, so match it by hand
  // or the end code goes out one bit too narrow.
  if (nextCode === 1 << width && width < 12) width += 1;
  emit(endCode);
  if (bitCount > 0) {
    out[outLen] = bitBuffer & 0xff;
    outLen += 1;
  }
  return out.subarray(0, outLen);
}

/* ------------------------------------------------------------------------ *
 * GIF89a container.
 * ------------------------------------------------------------------------ */

class ByteSink {
  private buf = new Uint8Array(32 * 1024);
  private len = 0;

  private room(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    const grown = new Uint8Array(Math.max(this.buf.length * 2, this.len + extra));
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  byte(value: number): void {
    this.room(1);
    this.buf[this.len] = value & 0xff;
    this.len += 1;
  }

  /** Little-endian, as every multi-byte number in the format is. */
  u16(value: number): void {
    this.byte(value & 0xff);
    this.byte((value >> 8) & 0xff);
  }

  bytes(data: Uint8Array): void {
    this.room(data.length);
    this.buf.set(data, this.len);
    this.len += data.length;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.len)); // a copy the caller owns
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const FULL_FRAME: Rect = { x: 0, y: 0, w: GIF_WIDTH, h: GIF_HEIGHT };

/**
 * The smallest rectangle holding every pixel that differs between two frames.
 * Two identical frames still give a 1 x 1 rectangle: a frame has to exist to
 * carry its second of delay, and the format has no zero-sized image.
 */
function changedRect(before: Uint8Array, after: Uint8Array): Rect {
  let minX = GIF_WIDTH;
  let minY = GIF_HEIGHT;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < GIF_HEIGHT; y += 1) {
    const row = y * GIF_WIDTH;
    for (let x = 0; x < GIF_WIDTH; x += 1) {
      if (before[row + x] !== after[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function writeHeader(sink: ByteSink): void {
  for (const ch of "GIF89a") sink.byte(ch.charCodeAt(0));
  sink.u16(GIF_WIDTH);
  sink.u16(GIF_HEIGHT);
  // Global colour table present, 8 bits of colour resolution, table of 2^(n+1) entries.
  sink.byte(0x80 | 0x70 | (PALETTE_BITS - 1));
  sink.byte(BG); // background colour index
  sink.byte(0); // pixel aspect ratio: none given
  for (const [r, g, b] of PALETTE) {
    sink.byte(r);
    sink.byte(g);
    sink.byte(b);
  }
}

function writeFrame(sink: ByteSink, canvas: Uint8Array, rect: Rect, delayCs: number): void {
  // Graphic control extension: leave this frame in place, no transparency.
  sink.byte(0x21);
  sink.byte(0xf9);
  sink.byte(4);
  sink.byte(0x04); // disposal method 1 (do not dispose), no user input, no transparent colour
  sink.u16(delayCs);
  sink.byte(0); // transparent colour index, unused
  sink.byte(0);

  // Image descriptor: no local colour table, not interlaced.
  sink.byte(0x2c);
  sink.u16(rect.x);
  sink.u16(rect.y);
  sink.u16(rect.w);
  sink.u16(rect.h);
  sink.byte(0);

  let pixels: Uint8Array;
  if (rect.w === GIF_WIDTH && rect.h === GIF_HEIGHT) {
    pixels = canvas;
  } else {
    pixels = new Uint8Array(rect.w * rect.h);
    for (let row = 0; row < rect.h; row += 1) {
      const from = (rect.y + row) * GIF_WIDTH + rect.x;
      pixels.set(canvas.subarray(from, from + rect.w), row * rect.w);
    }
  }

  sink.byte(PALETTE_BITS);
  const data = lzwEncode(pixels, PALETTE_BITS);
  for (let offset = 0; offset < data.length; offset += 255) {
    const size = Math.min(255, data.length - offset);
    sink.byte(size);
    sink.bytes(data.subarray(offset, offset + size));
  }
  sink.byte(0); // end of this image's data
}

export interface CountdownGifOptions {
  /** How many one-second frames to draw. Defaults to 60. */
  frames?: number;
}

/** One still frame with a message on it: "This offer has ended" and the like. */
export function renderMessageGif(text: string): Buffer {
  const sink = new ByteSink();
  writeHeader(sink);
  writeFrame(sink, messageCanvas(text.toUpperCase()), FULL_FRAME, 0);
  sink.byte(0x3b);
  return sink.toBuffer();
}

/**
 * The countdown GIF for somebody opening an email with `remainingSeconds` left.
 *
 * Sixty frames, a second each, counting down from that moment. Should the
 * deadline arrive while it plays, the remaining frames show the "ended" message
 * rather than a row of zeroes, so the picture it holds at the end is true.
 * At or past the deadline it is a single still "ended" frame.
 */
export function renderCountdownGif(remainingSeconds: number, opts: CountdownGifOptions = {}): Buffer {
  const start = normaliseRemaining(remainingSeconds);
  if (start <= 0) return renderMessageGif(ENDED_TEXT);

  const wanted = Number.isFinite(opts.frames) ? Math.floor(opts.frames as number) : FRAME_COUNT;
  const frames = Math.min(600, Math.max(1, wanted));
  const ended = messageCanvas(ENDED_TEXT);

  const sink = new ByteSink();
  writeHeader(sink);

  let previous = new Uint8Array(PIXELS);
  let current = new Uint8Array(PIXELS);
  for (let i = 0; i < frames; i += 1) {
    const seconds = start - i;
    if (seconds > 0) paintCountdown(current, seconds);
    else current.set(ended);
    writeFrame(sink, current, i === 0 ? FULL_FRAME : changedRect(previous, current), FRAME_DELAY_CS);
    const swap = previous;
    previous = current;
    current = swap;
  }

  sink.byte(0x3b);
  return sink.toBuffer();
}

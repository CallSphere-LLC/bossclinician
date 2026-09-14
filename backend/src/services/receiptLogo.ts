import fs, { type FileHandle } from "fs/promises";
import path from "path";
import { env } from "../config/env";

/**
 * The receipt logo, read from the server's own public uploads.
 *
 * The receipt customiser stores a reference (`/uploads/<file>`, exactly what the
 * media upload hands back), never a remote address. That is deliberate on both
 * documents:
 *
 *  - The HTML receipt is served with `img-src data:` and nothing else, so the
 *    logo has to travel inside the page as a data URI.
 *  - The PDF needs the bytes, and fetching an arbitrary URL from the server to
 *    get them would turn a settings box into a way to make this server request
 *    anything on its network.
 *
 * So the file is read from disk, confined to the upload directory, capped in
 * size, and recognised by its signature rather than its name — PNG and JPEG are
 * the only formats pdfkit draws, and a logo that works on screen but breaks the
 * PDF is worse than none. Every failure answers null: a receipt without its logo
 * is still a receipt.
 */

export type ReceiptLogoMime = "image/png" | "image/jpeg";

export interface ReceiptLogo {
  mime: ReceiptLogoMime;
  bytes: Buffer;
  /** Ready for an <img src> under a `img-src data:` policy. */
  dataUri: string;
}

/** A logo is a heading, not a photograph; anything bigger is a mistake. */
export const MAX_RECEIPT_LOGO_BYTES = 2 * 1024 * 1024;

const UPLOAD_REFERENCE = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]{0,199})$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What the file actually is, by its first bytes. */
export function sniffLogoMime(bytes: Buffer): ReceiptLogoMime | null {
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

export async function loadReceiptLogo(
  reference: string | undefined,
  uploadDir: string = env.uploadDir
): Promise<ReceiptLogo | null> {
  const match = UPLOAD_REFERENCE.exec((reference ?? "").trim());
  if (!match) return null;

  const root = path.resolve(uploadDir);
  const file = path.resolve(root, match[1]);
  // The pattern already forbids a separator; this is the belt to that brace.
  if (path.dirname(file) !== root) return null;

  let handle: FileHandle | undefined;
  try {
    // One descriptor for the size check and the read. Checking the path and then
    // reading the path gave it two chances to be different files: replaced or
    // grown in between, the cap was measured on one and the bytes came from the
    // other. O_NOFOLLOW because the confinement above is to the directory, and a
    // symlink planted in it would otherwise be read wherever it points;
    // O_NONBLOCK so that a FIFO fails the isFile check instead of hanging here.
    handle = await fs.open(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_RECEIPT_LOGO_BYTES) return null;
    // One byte more than was measured: if it arrives, the file grew after the
    // stat and is no longer the file that passed the cap.
    const buffer = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0 || bytesRead > stat.size) return null;
    const bytes = buffer.subarray(0, bytesRead);
    const mime = sniffLogoMime(bytes);
    if (mime === null) return null;
    return { mime, bytes, dataUri: `data:${mime};base64,${bytes.toString("base64")}` };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

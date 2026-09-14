/**
 * What the receipt logo box will accept, checked before anything is uploaded.
 *
 * Receipts are also PDFs, and a PDF can draw a PNG or a JPEG and nothing else —
 * the server refuses any other format when the setting is saved and again when
 * a receipt reads the file. Saying so next to the box, before the upload, is
 * what stops a logo from quietly never appearing.
 */

export const RECEIPT_LOGO_TYPES = ["image/png", "image/jpeg"];
export const RECEIPT_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Empty when the file can be used; otherwise the sentence to show beside the box. */
export function logoFileProblem(file: { type: string; size: number }): string {
  if (!RECEIPT_LOGO_TYPES.includes(file.type)) {
    return "That file isn't a PNG or a JPEG. Receipts are also saved as PDFs, and those are the only two picture formats a PDF can show.";
  }
  if (file.size > RECEIPT_LOGO_MAX_BYTES) {
    return "That picture is bigger than 2 MB. Export a smaller copy of the logo and try again.";
  }
  return "";
}

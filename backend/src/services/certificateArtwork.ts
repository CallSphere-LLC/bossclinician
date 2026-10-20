import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

/**
 * Layout values are PDF points measured from the slide's top-left corner.
 * Only bundled, versioned PNG assets are accepted. A template cannot make the
 * API fetch an arbitrary URL or read an arbitrary path while issuing a PDF.
 */
type Box = [number, number, number, number];
type Font = "Helvetica" | "Helvetica-Bold" | "Times-Bold" | "Times-BoldItalic";

interface TextField {
  erase: Box;
  draw: Box;
  font: Font;
  size: number;
  color: string;
}

interface VerificationField {
  draw: Box;
  size: number;
  color: string;
  align?: "left" | "center" | "right";
}

export interface CertificateBackgroundLayout {
  page: { width: number; height: number };
  recipient: TextField;
  date: TextField;
  verification: VerificationField;
  creditQuarterHours: number;
  providerNumber: string;
}

const FONTS = new Set<Font>(["Helvetica", "Helvetica-Bold", "Times-Bold", "Times-BoldItalic"]);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const BASENAME = /^[a-z0-9][a-z0-9-]*\.png$/;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid certificate background layout");
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error("Invalid certificate background coordinate");
  }
  return value;
}

function box(value: unknown, page: { width: number; height: number }): Box {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error("Invalid certificate background box");
  }
  const x = number(value[0], 0, page.width);
  const y = number(value[1], 0, page.height);
  const width = number(value[2], 1, page.width);
  const height = number(value[3], 1, page.height);
  if (x + width > page.width || y + height > page.height) {
    throw new Error("Certificate background box exceeds page");
  }
  return [x, y, width, height];
}

function color(value: unknown): string {
  if (typeof value !== "string" || !COLOR.test(value)) {
    throw new Error("Invalid certificate background color");
  }
  return value;
}

function textField(value: unknown, page: { width: number; height: number }): TextField {
  const field = record(value);
  if (!FONTS.has(field.font as Font)) {
    throw new Error("Invalid certificate background font");
  }
  return {
    erase: box(field.erase, page),
    draw: box(field.draw, page),
    font: field.font as Font,
    size: number(field.size, 8, 40),
    color: color(field.color),
  };
}

export function parseCertificateBackgroundLayout(value: unknown): CertificateBackgroundLayout {
  const input = record(value);
  const pageValue = record(input.page);
  const page = {
    width: number(pageValue.width, 500, 1200),
    height: number(pageValue.height, 400, 900),
  };
  const verification = record(input.verification);
  const align = verification.align === undefined ? "center" : verification.align;
  if (align !== "left" && align !== "center" && align !== "right") {
    throw new Error("Invalid certificate verification alignment");
  }
  if (typeof input.providerNumber !== "string" || input.providerNumber.length > 80) {
    throw new Error("Invalid certificate provider number");
  }
  return {
    page,
    recipient: textField(input.recipient, page),
    date: textField(input.date, page),
    verification: {
      draw: box(verification.draw, page),
      size: number(verification.size, 6, 14),
      color: color(verification.color),
      align,
    },
    creditQuarterHours: number(input.creditQuarterHours, 0, 100),
    providerNumber: input.providerNumber,
  };
}

export function certificateBackgroundPath(filename: string): string {
  if (!BASENAME.test(filename)) {
    throw new Error("Invalid certificate background filename");
  }
  const absolute = path.join(process.cwd(), "assets", "certificates", filename);
  const stats = fs.statSync(absolute);
  if (!stats.isFile() || stats.size > MAX_ASSET_BYTES) {
    throw new Error("Invalid certificate background asset");
  }
  return absolute;
}

function fitText(doc: PDFKit.PDFDocument, text: string, field: TextField): void {
  const [x, y, width, height] = field.draw;
  doc.font(field.font);
  let size = field.size;
  while (size > 8 && doc.fontSize(size).widthOfString(text) > width - 4) size -= 1;
  if (doc.fontSize(size).widthOfString(text) > width - 4) {
    throw new Error("Certificate recipient name does not fit");
  }
  doc.fillColor(field.color).text(text, x, y + Math.max(0, (height - size * 1.15) / 2), {
    width,
    height,
    align: "center",
    lineBreak: false,
  });
}

function erase(doc: PDFKit.PDFDocument, box: Box): void {
  const [x, y, width, height] = box;
  doc.rect(x, y, width, height).fill("#FFFFFF");
}

function longDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export async function renderBrandedCertificatePdf(input: {
  image: string;
  layout: CertificateBackgroundLayout;
  recipientName: string;
  completedAt: Date;
  verificationCode: string;
  publicSiteUrl: string;
  creditQuarterHours: number;
  providerNumber: string;
  title: string;
}): Promise<Buffer> {
  const { layout } = input;
  if (
    input.creditQuarterHours !== layout.creditQuarterHours ||
    input.providerNumber !== layout.providerNumber
  ) {
    throw new Error("Certificate artwork credit/provider does not match issued record");
  }
  const asset = certificateBackgroundPath(input.image);
  const doc = new PDFDocument({
    size: [layout.page.width, layout.page.height],
    margin: 0,
    info: {
      Title: input.title,
      Author: "Boss Clinician, LLC",
      Subject: `Certificate ${input.verificationCode}`,
    },
  });
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.image(asset, 0, 0, { width: layout.page.width, height: layout.page.height });
  erase(doc, layout.recipient.erase);
  erase(doc, layout.date.erase);
  fitText(doc, input.recipientName.slice(0, 90), layout.recipient);
  fitText(doc, longDate(input.completedAt), layout.date);

  const [x, y, width, height] = layout.verification.draw;
  const align = layout.verification.align ?? "center";
  doc.font("Helvetica").fontSize(layout.verification.size).fillColor(layout.verification.color);
  doc.text(`Verify: ${input.verificationCode}`, x, y, { width, height: height / 2, align });
  doc.fontSize(Math.max(6, layout.verification.size - 1));
  doc.text(
    `${input.publicSiteUrl.replace(/\/$/, "")}/verify/${input.verificationCode}`,
    x, y + height / 2, { width, height: height / 2, align }
  );
  doc.end();
  return done;
}

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseCertificateBackgroundLayout, renderBrandedCertificatePdf } from "./certificateArtwork";

/**
 * Sheet row 242: the on-demand Do's & Don'ts certificate (template 4, course 63)
 * is Yvette's slide used as a full-page background, with the member's name and
 * the completion date drawn on the slide's two underlines.
 */
const MIGRATION = fs.readFileSync(
  path.join(__dirname, "../db/migrations/201_dos_donts_ondemand_certificate_v2.sql"),
  "utf8"
);
const layoutJson = MIGRATION.match(/\$layout\$([\s\S]*?)\$layout\$/)?.[1] ?? "";
const layout = parseCertificateBackgroundLayout(JSON.parse(layoutJson));

/** Underlines in the slide (PDF points from the top-left of the 960x540 page). */
const NAME_UNDERLINE_Y = 234;
const DATE_UNDERLINE_Y = 399.6;
const SEAL_TOP_Y = 405.4;

const ASSET = path.join(process.cwd(), "assets", "certificates", "dos-donts-ondemand-v2.png");

describe("Do's & Don'ts on-demand certificate (migration 201)", () => {
  it("states 3.5 CE hours under NBCC ACEP No. 7998", () => {
    expect(layout.creditQuarterHours).toBe(14);
    expect(layout.providerNumber).toBe("7998");
    expect(MIGRATION).toMatch(/ceu_provider_number = '7998'/);
    expect(MIGRATION).toMatch(/WHERE id = 4\s+AND course_id = 63/);
  });

  it("never paints over the slide's underlines or the NBCC seal", () => {
    const [, nameY, , nameH] = layout.recipient.erase;
    const [, dateY, , dateH] = layout.date.erase;
    expect(nameY + nameH).toBeLessThanOrEqual(NAME_UNDERLINE_Y);
    expect(dateY + dateH).toBeLessThanOrEqual(DATE_UNDERLINE_Y);
    expect(layout.date.draw[1] + layout.date.draw[3]).toBeLessThan(SEAL_TOP_Y);
  });

  it("centres the name and date on the page", () => {
    for (const [x, , width] of [layout.recipient.draw, layout.date.draw]) {
      expect(Math.abs(x + width / 2 - 480)).toBeLessThanOrEqual(1);
    }
  });

  it.skipIf(!fs.existsSync(ASSET))("renders a one-page PDF with a long name", async () => {
    const pdf = await renderBrandedCertificatePdf({
      image: "dos-donts-ondemand-v2.png",
      layout,
      recipientName: "Dr. Alexandra Constantinopoulos-Fitzwilliam, LCSW, LMFT",
      completedAt: new Date("2026-11-21T12:00:00Z"),
      verificationCode: "BC-4KQ2-9XJH-7M3T-P8ZR",
      publicSiteUrl: "https://www.bossclinician.com",
      creditQuarterHours: 14,
      providerNumber: "7998",
      title: "Certificate of Completion — The Do's & Don'ts of Clinical Documentation",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).toHaveLength(1);
  });

  it.skipIf(!fs.existsSync(ASSET))("refuses a record issued under the old provider number", async () => {
    await expect(
      renderBrandedCertificatePdf({
        image: "dos-donts-ondemand-v2.png",
        layout,
        recipientName: "Zz Test",
        completedAt: new Date("2026-11-21T12:00:00Z"),
        verificationCode: "BC-4KQ2-9XJH-7M3T-P8ZR",
        publicSiteUrl: "https://www.bossclinician.com",
        creditQuarterHours: 14,
        providerNumber: "2026-18",
        title: "Certificate",
      })
    ).rejects.toThrow(/credit\/provider/);
  });
});

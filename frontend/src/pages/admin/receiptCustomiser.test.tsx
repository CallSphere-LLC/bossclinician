import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { logoFileProblem } from "@/lib/receiptLogo";
import type { SettingField } from "@/lib/settingsApi";
import { ImageFieldInput, ReceiptPreviewCard } from "./SettingsGroup";

const logoField: SettingField = {
  name: "logoUrl",
  label: "Logo",
  help: "A PNG or JPEG, printed at the top of every receipt.",
  type: "image",
};

describe("receipt customiser", () => {
  it("refuses a logo a PDF cannot draw, and says why", () => {
    expect(logoFileProblem({ type: "image/webp", size: 1_000 })).toMatch(/isn't a PNG or a JPEG/);
    expect(logoFileProblem({ type: "image/svg+xml", size: 10 })).toMatch(/isn't a PNG or a JPEG/);
    expect(logoFileProblem({ type: "image/png", size: 3 * 1024 * 1024 })).toMatch(/bigger than 2 MB/);
    expect(logoFileProblem({ type: "image/png", size: 5_000 })).toBe("");
    expect(logoFileProblem({ type: "image/jpeg", size: 5_000 })).toBe("");
  });

  it("shows the saved logo, only offers PNG and JPEG, and lets it be removed", () => {
    const html = renderToStaticMarkup(
      <ImageFieldInput id="setting-logoUrl" field={logoField} value="/uploads/abc123.png" onChange={() => undefined} />,
    );

    expect(html).toContain('src="/uploads/abc123.png"');
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain("Remove the logo");
  });

  it("says what heads the receipt when there is no logo", () => {
    const html = renderToStaticMarkup(
      <ImageFieldInput id="setting-logoUrl" field={logoField} value="" onChange={() => undefined} />,
    );

    expect(html).toContain("No logo — your business name heads the receipt.");
    expect(html).not.toContain("Remove the logo");
  });

  it("offers a sample receipt and its PDF to check the result", () => {
    const html = renderToStaticMarkup(<ReceiptPreviewCard />);

    expect(html).toContain("See a sample receipt");
    expect(html).toContain("Open a sample receipt");
    expect(html).toContain("Sample PDF");
  });
});

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { existsSync } from "node:fs";
import { NbccApproval } from "./NbccApproval";
import { NBCC_ACEP_LOGO, NBCC_APPROVAL_STATEMENT } from "@/content/nbcc";
import { club, clubCheckout } from "@/content/club";

describe("NBCC approval statement (ACEP letter, directive A)", () => {
  it("uses NBCC's exact wording", () => {
    expect(NBCC_APPROVAL_STATEMENT).toBe(
      "Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of the programs.",
    );
  });

  it("always shows the ACEP logo beside the statement", () => {
    const html = renderToString(<NbccApproval />);
    expect(html).toContain(NBCC_ACEP_LOGO.src);
    expect(html).toContain("ACEP No. 7998");
    expect(existsSync(new URL(`../../../public${NBCC_ACEP_LOGO.src}`, import.meta.url))).toBe(true);
  });

  it("page paragraphs passed in still carry the exact statement", () => {
    for (const text of [club.nbcc, clubCheckout.nbcc]) expect(text).toContain(NBCC_APPROVAL_STATEMENT);
  });
});

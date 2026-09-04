import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CouponField } from "./CouponField";

describe("CouponField", () => {
  it("renders an ineligible code as a visible, labelled checkout error", () => {
    const html = renderToStaticMarkup(
      <CouponField
        value="ZZONLYOTHER"
        onChange={() => undefined}
        pending={false}
        applied={null}
        error="That discount code isn't valid for this offer."
        discount={null}
      />,
    );

    expect(html).toContain("That discount code isn&#x27;t valid for this offer.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });
});

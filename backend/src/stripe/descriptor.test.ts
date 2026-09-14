import { beforeEach, describe, expect, it, vi } from "vitest";

const { pricesRetrieve, productsRetrieve, productsUpdate } = vi.hoisted(() => ({
  pricesRetrieve: vi.fn(),
  productsRetrieve: vi.fn(),
  productsUpdate: vi.fn(),
}));

// Every Stripe call is a mock: the key in .env is a live one, and nothing in
// this suite may reach it.
vi.mock("./client", () => ({
  stripe: () => ({
    prices: { retrieve: pricesRetrieve },
    products: { retrieve: productsRetrieve, update: productsUpdate },
  }),
}));

import { applyDescriptorToPrice, forgetAppliedDescriptors } from "./descriptor";

beforeEach(() => {
  forgetAppliedDescriptors();
  pricesRetrieve.mockReset().mockResolvedValue({ product: "prod_zz_1" });
  productsRetrieve.mockReset();
  productsUpdate.mockReset().mockResolvedValue({});
});

describe("statement descriptor on subscription products", () => {
  it("does nothing when no descriptor is set", async () => {
    await expect(applyDescriptorToPrice("price_zz_1", undefined)).resolves.toBe("skipped");
    expect(pricesRetrieve).not.toHaveBeenCalled();
  });

  it("puts the descriptor on an existing product that lacks it, once", async () => {
    productsRetrieve.mockResolvedValue({ id: "prod_zz_1", statement_descriptor: null });

    await expect(applyDescriptorToPrice("price_zz_1", "BOSSCLINICIAN")).resolves.toBe("updated");
    expect(productsUpdate).toHaveBeenCalledWith("prod_zz_1", { statement_descriptor: "BOSSCLINICIAN" });

    await expect(applyDescriptorToPrice("price_zz_1", "BOSSCLINICIAN")).resolves.toBe("unchanged");
    expect(productsUpdate).toHaveBeenCalledTimes(1);
    expect(pricesRetrieve).toHaveBeenCalledTimes(1);
  });

  it("leaves a product that already matches alone", async () => {
    productsRetrieve.mockResolvedValue({ id: "prod_zz_1", statement_descriptor: "BOSSCLINICIAN" });
    await expect(applyDescriptorToPrice("price_zz_1", "BOSSCLINICIAN")).resolves.toBe("unchanged");
    expect(productsUpdate).not.toHaveBeenCalled();
  });

  it("follows a change of the setting", async () => {
    productsRetrieve.mockResolvedValueOnce({ id: "prod_zz_1", statement_descriptor: "BOSSCLINICIAN" });
    await applyDescriptorToPrice("price_zz_1", "BOSSCLINICIAN");
    productsRetrieve.mockResolvedValueOnce({ id: "prod_zz_1", statement_descriptor: "BOSSCLINICIAN" });
    await expect(applyDescriptorToPrice("price_zz_1", "BOSS CLINIC")).resolves.toBe("updated");
    expect(productsUpdate).toHaveBeenCalledWith("prod_zz_1", { statement_descriptor: "BOSS CLINIC" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyProduct } from "../lib/stellar.js";

describe("@veritag/web verification logic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Offline test mode")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves offline/demo verification states accurately across serial patterns", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const unclaimed = await verifyProduct(brand, batch, "CH-2026-000101");
    expect(unclaimed.status).toBe("AuthenticInactive");
    expect(unclaimed.authentic).toBe(true);

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    expect(active.status).toBe("AuthenticActive");
    expect(active.unit?.warrantyValid).toBe(true);

    const dup = await verifyProduct(brand, batch, "CH-2026-DUP-88");
    expect(dup.status).toBe("AlreadyClaimedWarning");
    expect(dup.suspiciousScanVolume).toBe(true);

    const recalled = await verifyProduct(brand, batch, "CH-2026-RECALL-19");
    expect(recalled.status).toBe("Recalled");

    const fake = await verifyProduct(brand, batch, "FAKE-000999");
    expect(fake.status).toBe("Unknown");
    expect(fake.authentic).toBe(false);
  });
});

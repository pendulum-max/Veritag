import { expect, test } from "@playwright/test";

const DEMO_BRAND = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
const DEMO_BATCH = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";
const DEMO_SERIAL = "CH-2026-000101";
const PREFILLED_SECRET = "DEMO-SECRET-2026-9999";

test.describe("QR scan-to-activation end-to-end flow", () => {
  test("scans QR with pre-filled secret, connects simulated passkey wallet, and activates unit", async ({
    page,
  }) => {
    let capturedActivationBody = null as Record<string, unknown> | null;

    await page.route("**/v1/passkey/register", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stellarSmartAddress: "CC7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO",
          token: "e2e-mock-jwt-token",
        }),
      });
    });

    await page.route("**/v1/activate", async (route) => {
      capturedActivationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          unitId: "7c4a8d09ca3762af61e59520943dc26494f8941b00112233445566778899aabb",
          sponsoredTxHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        }),
      });
    });

    await page.goto(
      `/v/${DEMO_BRAND}/${DEMO_BATCH}/${DEMO_SERIAL}#s=${encodeURIComponent(PREFILLED_SECRET)}`,
    );

    // 1. Verify authenticity banner & product metadata
    await expect(page.getByText(DEMO_SERIAL)).toBeVisible();
    await expect(page.getByText("chronos-watches.swiss")).toBeVisible();
    await expect(page.getByText("Claim & Activate Warranty")).toBeVisible();

    // 2. Verify secret was pre-filled from QR URL hash fragment (#s=...)
    const secretInput = page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX");
    await expect(secretInput).toHaveValue(PREFILLED_SECRET);

    // 3. Connect simulated passkey wallet (uses WebCrypto P-256 fallback in headless Chromium)
    await page.getByRole("button", { name: "+ Create Passkey Wallet" }).click();

    const ownerInput = page.getByPlaceholder("G... or C... smart wallet address");
    await expect(ownerInput).toHaveValue(/^C[A-Z0-9]{55}$/);
    await expect(page.getByText(/Passkey smart account deployed & connected:/)).toBeVisible();

    // 4. Confirm on-chain lazy activation
    await page.getByRole("button", { name: "Activate Product & Start Warranty" }).click();
    await expect(page.getByText(/Unit activated on-chain!/)).toBeVisible();
    await expect(page.getByText(/Sponsored Tx: abcdef123456/)).toBeVisible();

    expect(capturedActivationBody).not.toBeNull();
    expect(capturedActivationBody?.brand).toBe(DEMO_BRAND);
    expect(capturedActivationBody?.batchId).toBe(DEMO_BATCH);
    expect(capturedActivationBody?.serial).toBe(DEMO_SERIAL);
    expect(capturedActivationBody?.secret).toBe(PREFILLED_SECRET);
    expect(String(capturedActivationBody?.firstOwner ?? "")).toMatch(/^C[A-Z0-9]{55}$/);
  });
});

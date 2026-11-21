import { ImageResponse } from "next/og";
import { verifyProduct } from "@/lib/stellar";

export const alt = "Veritag Product Authenticity Verification";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

interface OgTheme {
  badgeLabel: string;
  bannerText: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
}

function getOgTheme(status: string, authentic: boolean): OgTheme {
  if (status === "Recalled") {
    return {
      badgeLabel: "SAFETY RECALL ACTIVE",
      bannerText: "Manufacturer Recall Issued — Check Details",
      accentColor: "#dc2626",
      accentBg: "#fef2f2",
      accentBorder: "#fecaca",
    };
  }
  if (status === "AlreadyClaimedWarning") {
    return {
      badgeLabel: "DUPLICATE CLAIM WARNING",
      bannerText: "Already Claimed · Verify Ownership Before Resale",
      accentColor: "#d97706",
      accentBg: "#fffbeb",
      accentBorder: "#fde68a",
    };
  }
  if (!authentic || status === "Unknown" || status === "Flagged") {
    return {
      badgeLabel: "UNVERIFIED SERIAL",
      bannerText: "Not Found in Any Committed Stellar Batch",
      accentColor: "#dc2626",
      accentBg: "#fef2f2",
      accentBorder: "#fecaca",
    };
  }
  return {
    badgeLabel: status === "AuthenticActive" ? "AUTHENTIC · ACTIVATED" : "AUTHENTIC · VERIFIED",
    bannerText: "Genuine & Warranty Protected",
    accentColor: "#059669",
    accentBg: "#ecfdf5",
    accentBorder: "#a7f3d0",
  };
}

export default async function Image({
  params,
}: {
  params: Promise<{ brand: string; serial: string }>;
}) {
  const { brand: rawBrand, serial: rawSerial } = await params;
  const brand = decodeURIComponent(rawBrand);
  const serial = decodeURIComponent(rawSerial);

  const summary = await verifyProduct(brand, "default", serial);
  const theme = getOgTheme(summary.status, summary.authentic);
  const brandLabel = summary.brand.domain ?? (brand.length > 20 ? `${brand.slice(0, 12)}...` : brand);
  const warrantyLabel =
    summary.unit?.warrantyValid && summary.unit.warrantyExpiry > 0
      ? `Warranty valid until ${new Date(summary.unit.warrantyExpiry * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : summary.batch
        ? `${summary.batch.warrantyMonths}-month manufacturer warranty`
        : "On-chain provenance check";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0f172a",
          color: "#f8fafc",
          padding: "56px 64px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top bar: Brand logo + Authenticity shield badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "14px",
                backgroundColor: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "26px", fontWeight: 700, letterSpacing: "-0.02em" }}>
                Veritag
              </span>
              <span style={{ fontSize: "16px", color: "#94a3b8" }}>{brandLabel}</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 20px",
              borderRadius: "9999px",
              backgroundColor: theme.accentBg,
              border: `2px solid ${theme.accentBorder}`,
              color: theme.accentColor,
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={theme.accentColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span>{theme.badgeLabel}</span>
          </div>
        </div>

        {/* Center: Product title & Genuine & Warranty Protected banner */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ fontSize: "20px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Product Authenticity Certificate
          </div>
          <div
            style={{
              fontSize: "54px",
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "#ffffff",
            }}
          >
            {serial}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              padding: "16px 24px",
              borderRadius: "16px",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              border: `1px solid ${theme.accentColor}`,
              alignSelf: "flex-start",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "9999px",
                backgroundColor: theme.accentColor,
              }}
            />
            <span style={{ fontSize: "24px", fontWeight: 700, color: "#f8fafc" }}>
              {theme.bannerText}
            </span>
          </div>
        </div>

        {/* Bottom: Warranty & Stellar Soroban Seal */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(148, 163, 184, 0.25)",
            paddingTop: "24px",
            fontSize: "18px",
            color: "#cbd5e1",
          }}
        >
          <span>{warrantyLabel}</span>
          <span style={{ color: "#60a5fa", fontWeight: 600 }}>
            Anchored on Stellar Soroban · veritag.app
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}

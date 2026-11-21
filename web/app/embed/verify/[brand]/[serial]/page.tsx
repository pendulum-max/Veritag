import type { Metadata } from "next";
import { EmbedBadge } from "@/components/EmbedBadge";
import { verifyProduct } from "@/lib/stellar";

export const metadata: Metadata = {
  title: "Veritag Authenticity Badge",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function EmbedVerifyPage({
  params,
}: {
  params: Promise<{ brand: string; serial: string }>;
}) {
  const { brand: rawBrand, serial: rawSerial } = await params;
  const brand = decodeURIComponent(rawBrand);
  const serial = decodeURIComponent(rawSerial);
  const summary = await verifyProduct(brand, "default", serial);

  return (
    <div className="flex min-h-[180px] w-full items-center justify-center bg-transparent p-2">
      <EmbedBadge summary={summary} brand={brand} serial={serial} />
    </div>
  );
}

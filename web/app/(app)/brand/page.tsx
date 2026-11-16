import { BrandView } from "@/components/mk/brand/brand-view";
import type { BrandKit } from "@/lib/brand-kit-client";
import type { Kit } from "@/lib/types";
import { safe } from "@/lib/workspace-server";

export const metadata = { title: "Brand · Marketer" };

export default async function BrandPage() {
  const [kit, kits] = await Promise.all([safe<BrandKit>("/api/v1/brand-kit"), safe<Kit[]>("/api/v1/kits")]);
  return <BrandView kit={kit} kits={kits} loadFailed={kit === null} />;
}

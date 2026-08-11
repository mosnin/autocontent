import { HomeHub } from "@/components/hub/home-hub";

export const dynamic = "force-dynamic";

// The suite launcher — the reference-style hub that presents each product
// dashboard as its own animated card (Campaigns, Content, SEO, Ads, Suite).
// From here you enter a product and get its focused dashboard + sidebar.
export default function HomePage() {
  return <HomeHub />;
}

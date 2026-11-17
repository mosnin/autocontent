import { HomeView } from "@/components/home/home-view";
import type { BrandKit } from "@/lib/brand-kit-client";
import { getActivity, getInbox, getOverview, safe } from "@/lib/workspace-server";

export const metadata = { title: "Home · Marketer" };

export default async function HomePage() {
  const [month, history, inbox, activity, brand] = await Promise.all([getOverview(30), getOverview(182), getInbox(), getActivity(12), safe<BrandKit>("/api/v1/brand-kit")]);
  return <HomeView brandName={brand?.brand_name || "Marketer"} month={month} history={history} inbox={inbox} activity={activity} />;
}

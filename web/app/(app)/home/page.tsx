import { HomeView } from "@/components/mk/home/home-view";
import { getInbox, getOverview } from "@/lib/workspace-server";

export const metadata = { title: "Home · Marketer" };

export default async function HomePage() {
  const [week, month, inbox] = await Promise.all([getOverview(7), getOverview(30), getInbox()]);
  return <HomeView week={week} month={month} inbox={inbox} />;
}

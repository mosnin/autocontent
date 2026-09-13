import { GuidePage } from "@/components/marketing/guide-page";
import guides from "@/lib/marketing/guides.json";
const guide = guides["plan-content-budget"];
export const metadata = {
  title: `${guide.title} · marketer.sh`,
  description: guide.description,
  alternates: {
    canonical: "https://marketer.sh/resources/guides/plan-content-budget",
  },
};
export default function Page() {
  return <GuidePage guide={guide} />;
}

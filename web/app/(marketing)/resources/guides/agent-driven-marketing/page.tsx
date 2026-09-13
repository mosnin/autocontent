import { GuidePage } from "@/components/marketing/guide-page";
import guides from "@/lib/marketing/guides.json";
const guide = guides["agent-driven-marketing"];
export const metadata = {
  title: `${guide.title} · marketer.sh`,
  description: guide.description,
  alternates: {
    canonical: "https://marketer.sh/resources/guides/agent-driven-marketing",
  },
};
export default function Page() {
  return <GuidePage guide={guide} />;
}

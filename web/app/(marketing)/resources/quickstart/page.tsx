import { GuidePage } from "@/components/marketing/guide-page";
import guides from "@/lib/marketing/guides.json";
const guide = guides["first-channel"];
export const metadata = {
  title: "Quickstart · marketer.sh",
  description: guide.description,
  alternates: { canonical: "https://marketer.sh/resources/quickstart" },
};
export default function Page() {
  return <GuidePage guide={guide} />;
}

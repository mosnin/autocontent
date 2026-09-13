import { GuidePage } from "@/components/marketing/guide-page";
import guides from "@/lib/marketing/guides.json";
const guide = guides["content-brief"];
export const metadata = {
  title: `${guide.title} · marketer.sh`,
  description: guide.description,
  alternates: {
    canonical: "https://marketer.sh/resources/guides/content-brief",
  },
};
export default function Page() {
  return <GuidePage guide={guide} />;
}

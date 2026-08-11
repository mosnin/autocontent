// Preview of the transcribed marketing site. Outside the (marketing) group
// so it renders with its own nav/footer rather than the legacy shell.
import { Reveal } from "@/components/site/reveal";
import { SitePage } from "@/components/site/page-full";
import "@/components/site/site.css";

export const dynamic = "force-dynamic";

export default function SitePreviewPage() {
  return (
    <>
      <SitePage />
      <Reveal />
    </>
  );
}

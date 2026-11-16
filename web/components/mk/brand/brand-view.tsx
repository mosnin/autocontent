import { Sparkles } from "lucide-react";
import { PageBody, PageHeader, PageIntro, SectionTitle } from "../page";
import { BrandEditor } from "./brand-editor";
import { Kits } from "./kits";
import { EMPTY_BRAND_KIT, type BrandKit } from "@/lib/brand-kit-client";
import type { Kit } from "@/lib/types";

export function BrandView({ kit, kits, loadFailed }: { kit: BrandKit | null; kits: Kit[] | null; loadFailed?: boolean }) {
  return (
    <>
      <PageHeader icon={<Sparkles />} title="Brand" />
      <PageBody width="6xl">
        <PageIntro title="How you sound, everywhere">One identity every department works from. New playbooks, videos, articles and ads are steered to this name, tone, audience, banned words and hashtags.</PageIntro>
        <div className="t-stagger space-y-10">
          {loadFailed && <p className="rounded-[14px] bg-subtle px-4 py-3 text-[13px] text-muted-foreground">We couldn't load your saved brand, so this starts blank. Saving will overwrite it.</p>}
          <BrandEditor initial={kit ?? EMPTY_BRAND_KIT} />
          <section id="kits" className="max-w-3xl">
            <SectionTitle>Kits · reusable skills the agents carry</SectionTitle>
            <Kits kits={kits} />
          </section>
        </div>
      </PageBody>
    </>
  );
}

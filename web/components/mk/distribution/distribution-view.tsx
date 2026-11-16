import { CalendarDays, Send } from "lucide-react";
import Link from "next/link";
import { StartSession } from "../agent/start-session";
import { PageBody, PageHeader, PageIntro, SectionTitle, TitledCard } from "../page";
import { ButtonLink } from "../ui";
import { CampaignsSection } from "./campaigns";
import { ThisWeek } from "./this-week";
import { Channels } from "./channels";
import { departmentById } from "@/lib/departments";
import type { CalendarItem, PlaybookRef } from "@/lib/business";
import type { AyrshareConnectStatus, Campaign } from "@/lib/types";

export function DistributionView({
  ayrshare,
  campaigns,
  calendar,
  playbooks,
}: {
  ayrshare: AyrshareConnectStatus | null;
  campaigns: Campaign[] | null;
  calendar: CalendarItem[] | null;
  playbooks: PlaybookRef[];
}) {
  const dept = departmentById("distribution")!;
  return (
    <>
      <PageHeader icon={<Send />} title="Distribution">
        <ButtonLink href="/plan" size="sm" variant="ghost">
          <CalendarDays /> Plan
        </ButtonLink>
      </PageHeader>
      <PageBody width="5xl">
        <PageIntro title="Where everything goes out">{dept.summary}</PageIntro>
        <div className="t-stagger space-y-8">
          <StartSession scope="distribution" lockScope suggestions={dept.asks} />

          <div className="grid gap-3 md:grid-cols-5">
            <section className="min-w-0 md:col-span-3">
              <SectionTitle action={<Link href="/integrations" className="text-[13px] text-muted-foreground hover:text-foreground">All integrations</Link>}>Channels</SectionTitle>
              <Channels status={ayrshare} />
            </section>
            <TitledCard className="md:col-span-2" icon={<CalendarDays />} title="This week" action={<Link href="/plan" className="text-[13px] text-muted-foreground hover:text-foreground">Open plan</Link>}>
              <ThisWeek items={calendar} playbooks={playbooks} />
            </TitledCard>
          </div>

          <section>
            <SectionTitle>Campaigns · content, SEO and ads in one push</SectionTitle>
            {campaigns === null ? (
              <p className="rounded-[14px] bg-subtle px-4 py-5 text-[13px] text-muted-foreground">We couldn't load your campaigns right now. Refresh in a moment.</p>
            ) : (
              <CampaignsSection campaigns={campaigns} hasPlaybooks={playbooks.length > 0} />
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}

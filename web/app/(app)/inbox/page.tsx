import { Inbox as InboxIcon } from "lucide-react";
import { InboxRow } from "@/components/mk/inbox/inbox-row";
import { List, PageBody, PageHeader, PageIntro, SectionTitle } from "@/components/mk/page";
import { Badge, ButtonLink, Empty } from "@/components/mk/ui";
import type { InboxKind } from "@/lib/workspace";
import { getInbox } from "@/lib/workspace-server";

export const metadata = { title: "Inbox · Marketer" };

const GROUPS: { kind: InboxKind; label: string; why: string }[] = [
  { kind: "ad_change", label: "Ad changes", why: "Real money. The Media buyer never moves a budget or launches without you." },
  { kind: "video", label: "Videos", why: "Playbooks set to approve-before-post wait here before they go out." },
  { kind: "carousel", label: "Carousels", why: "Ready to post once you say yes." },
];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const { focus } = await searchParams;
  const inbox = await getInbox();
  const total = inbox?.counts.total ?? 0;
  return (
    <>
      <PageHeader icon={<InboxIcon />} title="Inbox">
        {total > 0 && <Badge tone="warn">{total} waiting</Badge>}
      </PageHeader>
      <PageBody width="4xl">
        <PageIntro title="Waiting on you">Everything any department wants to post or spend, in one place. Approve here, in a session, or from the API.</PageIntro>
        {!inbox ? (
          <Empty art="activity" title="Couldn't load your inbox">The API didn't answer. Try again in a moment.</Empty>
        ) : total === 0 ? (
          <Empty art="pins" title="You're all caught up" action={<ButtonLink href="/sessions/new" variant="primary">Ask Marketer for more</ButtonLink>}>
            New videos, carousels and ad changes that need a yes will land here.
          </Empty>
        ) : (
          <div className="t-stagger space-y-8">
            {GROUPS.map((g) => {
              const items = inbox.items.filter((i) => i.kind === g.kind);
              if (items.length === 0) return null;
              return (
                <section key={g.kind}>
                  <SectionTitle>
                    {g.label} · {items.length}
                  </SectionTitle>
                  <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">{g.why}</p>
                  <List>
                    {items.map((it) => (
                      <InboxRow key={it.id} item={it} focused={focus === it.id} />
                    ))}
                  </List>
                </section>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}

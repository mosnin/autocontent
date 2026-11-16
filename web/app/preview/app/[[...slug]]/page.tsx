// Unauthenticated design-review preview of the app shell with fixture data
// (no Clerk, no API). Used for screenshots in light and dark at desktop and
// phone widths. Not linked from the product. Add a view here when you build
// a page so it can be reviewed.

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HomeView } from "@/components/mk/home/home-view";
import { AppShell } from "@/components/mk/shell/app-shell";
import { PersonAvatar } from "@/components/mk/ui";
import { FIXTURE_INBOX, FIXTURE_MONTH, FIXTURE_WEEK } from "@/lib/fixtures";
import { PREVIEW_VIEWS } from "./views";

export const dynamic = "force-dynamic";

const steps = [
  { id: "brand", label: "Tell Marketer about your brand", detail: "", href: "/brand", done: true },
  { id: "playbook", label: "Create your first playbook", detail: "", href: "/playbooks/new", done: true },
  { id: "channels", label: "Connect your channels", detail: "TikTok, Reels and Shorts, so posts go out on schedule.", href: "/integrations", done: false },
  { id: "first", label: "Make your first piece", detail: "Ask Marketer for a video or an article.", href: "/sessions/new", done: true },
  { id: "ads", label: "Connect an ad account", detail: "Optional.", href: "/paid/connect", done: false },
];

export default async function PreviewApp({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const key = slug.join("/") || "home";
  const view: ReactNode | undefined = key === "home" ? <HomeView week={FIXTURE_WEEK} month={FIXTURE_MONTH} inbox={FIXTURE_INBOX} /> : await PREVIEW_VIEWS[key]?.();
  if (!view) notFound();
  return (
    <AppShell data={{ brandName: "Pasta Club", inbox: FIXTURE_INBOX, steps, isAdmin: false }} account={<PersonAvatar name="Sam" size={28} />}>
      {view}
    </AppShell>
  );
}

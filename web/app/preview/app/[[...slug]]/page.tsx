// Unauthenticated design-review preview of the app shell with fixture data
// (no Clerk, no API). Used for screenshots in light and dark at desktop and
// phone widths. Not linked from the product. Add a view here when you build
// a page so it can be reviewed.

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HomeView } from "@/components/home/home-view";
import { AppShell } from "@/components/shell/app-shell";
import { PersonAvatar } from "@/design-system";
import { FIXTURE_ACTIVITY, FIXTURE_HISTORY, FIXTURE_INBOX, FIXTURE_MONTH } from "@/lib/fixtures";
import { shellInbox } from "@/lib/workspace";
import { PREVIEW_VIEWS } from "./views";

export const dynamic = "force-dynamic";

const steps = [
  { id: "brand", label: "Tell Marketer about your brand", detail: "", href: "/brand", done: true },
  { id: "playbook", label: "Create your first playbook", detail: "", href: "/playbooks/new", done: true },
  { id: "channels", label: "Connect your channels", detail: "TikTok, Reels and Shorts, so posts go out on schedule.", href: "/integrations", done: false },
  { id: "first", label: "Make your first piece", detail: "Ask Marketer for a video or an article.", href: "/sessions/new", done: true },
  { id: "ads", label: "Connect an ad account", detail: "Optional.", href: "/paid/connect", done: false },
];

export default async function PreviewApp({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<{ theme?: string }> }) {
  const { slug = [] } = await params;
  const { theme } = await searchParams;
  const key = slug.join("/") || "home";
  const view: ReactNode | undefined = key === "home" ? <HomeView brandName="Pasta Club" month={FIXTURE_MONTH} history={FIXTURE_HISTORY} inbox={FIXTURE_INBOX} activity={FIXTURE_ACTIVITY} /> : await PREVIEW_VIEWS[key]?.();
  if (!view) notFound();
  return (
    <AppShell data={{ brandName: "Pasta Club", inbox: shellInbox(FIXTURE_INBOX), steps, isAdmin: false }} theme={theme === "light" ? "light" : "dark"} account={<PersonAvatar name="Sam" size={22} />}>
      {view}
    </AppShell>
  );
}

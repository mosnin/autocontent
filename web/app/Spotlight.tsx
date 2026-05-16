"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Spotlight, spotlight, type SpotlightActionData } from "@mantine/spotlight";
import {
  IconDashboard,
  IconList,
  IconPlugConnected,
  IconKey,
  IconPlus,
  IconRocket,
  IconSearch,
} from "@tabler/icons-react";

import { clientFetch } from "../lib/client-fetcher";
import type { Niche } from "../lib/types";

// Global command palette. Mounted once from AppShell. Bound to cmd-K /
// ctrl-K by Mantine's <Spotlight> internally (shortcut prop).
export function GlobalSpotlight() {
  const router = useRouter();
  // Cheap fetch — SWR dedupes and we don't need a refresh interval here.
  const { data: niches } = useSWR<Niche[]>("/api/v1/niches", clientFetch, {
    revalidateOnFocus: false,
  });

  const actions: SpotlightActionData[] = useMemo(() => {
    const baseActions: SpotlightActionData[] = [
      {
        id: "dashboard",
        label: "Go to dashboard",
        description: "Niche overview, spend, run buttons",
        leftSection: <IconDashboard size={18} />,
        onClick: () => router.push("/dashboard"),
      },
      {
        id: "queue",
        label: "Go to queue",
        description: "All jobs, in progress and done",
        leftSection: <IconList size={18} />,
        onClick: () => router.push("/queue"),
      },
      {
        id: "connect",
        label: "Connect socials",
        description: "Link TikTok, Reels, Shorts via Ayrshare",
        leftSection: <IconPlugConnected size={18} />,
        onClick: () => router.push("/connect"),
      },
      {
        id: "tokens",
        label: "API tokens",
        description: "Personal access tokens for CLI & MCP",
        leftSection: <IconKey size={18} />,
        onClick: () => router.push("/settings/tokens"),
      },
      {
        id: "create-niche",
        label: "Create niche",
        description: "Open the onboarding wizard",
        leftSection: <IconPlus size={18} />,
        onClick: () => router.push("/onboarding"),
      },
    ];

    const nicheActions: SpotlightActionData[] = (niches ?? []).map((n) => ({
      id: `enqueue-${n.id}`,
      label: `Enqueue ${n.title}`,
      description: `Run pipeline now on ${n.platforms.join(", ")}`,
      leftSection: <IconRocket size={18} />,
      onClick: () => {
        // Route to dashboard and trigger the run modal via query param.
        // The dashboard component reads ?run=<niche_id> on mount.
        router.push(`/dashboard?run=${n.id}`);
      },
    }));

    return [...baseActions, ...nicheActions];
  }, [router, niches]);

  return (
    <Spotlight
      actions={actions}
      nothingFound="Nothing found"
      shortcut={["mod + k", "mod + K"]}
      highlightQuery
      searchProps={{
        leftSection: <IconSearch size={18} />,
        placeholder: "Search actions, niches…",
      }}
    />
  );
}

export { spotlight };

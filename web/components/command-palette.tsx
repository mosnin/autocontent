"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  BarChart3,
  CalendarDays,
  Coins,
  FileText,
  Home,
  KeyRound,
  Layers,
  LayoutDashboard,
  Link2,
  ListChecks,
  Megaphone,
  Play,
  Plus,
  Settings,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import { clientFetch } from "@/lib/client-fetcher";
import type { Niche, Platform } from "@/lib/types";

// Brand-kicker treatment for cmdk group headings: uppercase, wide tracking,
// recording-orange. Matches the marketing/dashboard section kickers.
const KICKER =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-1 [&_[cmdk-group-heading]]:text-[0.65rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.25em] [&_[cmdk-group-heading]]:text-brand";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { openRunConfirm } = useRunConfirm();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: niches } = useSWR<Niche[]>(
    open ? "/api/v1/niches" : null,
    clientFetch,
  );

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  function enqueue(nicheId: string, platform: Platform) {
    setOpen(false);
    openRunConfirm({ nicheId, platform });
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle className="sr-only">Command palette</DialogTitle>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages" className={KICKER}>
          <CommandItem onSelect={() => go("/home")}>
            <Home className="text-muted-foreground" /> Home
          </CommandItem>
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard className="text-muted-foreground" /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/niches")}>
            <Layers className="text-muted-foreground" /> Channels
          </CommandItem>
          <CommandItem onSelect={() => go("/queue")}>
            <ListChecks className="text-muted-foreground" /> Queue
          </CommandItem>
          <CommandItem onSelect={() => go("/calendar")}>
            <CalendarDays className="text-muted-foreground" /> Calendar
          </CommandItem>
          <CommandItem onSelect={() => go("/press")}>
            <FileText className="text-muted-foreground" /> Press
          </CommandItem>
          <CommandItem onSelect={() => go("/articles")}>
            <FileText className="text-muted-foreground" /> Articles
          </CommandItem>
          <CommandItem onSelect={() => go("/ads")}>
            <Megaphone className="text-muted-foreground" /> Ads
          </CommandItem>
          <CommandItem onSelect={() => go("/ads/campaigns")}>
            <BarChart3 className="text-muted-foreground" /> Campaigns
          </CommandItem>
          <CommandItem onSelect={() => go("/connect")}>
            <Link2 className="text-muted-foreground" /> Connect socials
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings className="text-muted-foreground" /> Settings
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/billing")}>
            <Coins className="text-muted-foreground" /> Billing
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            <KeyRound className="text-muted-foreground" /> Tokens
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions" className={KICKER}>
          <CommandItem onSelect={() => go("/niches/new")}>
            <Plus className="text-muted-foreground" /> Create channel
          </CommandItem>
          <CommandItem onSelect={() => go("/articles?new=1")}>
            <FileText className="text-muted-foreground" /> New article
          </CommandItem>
          <CommandItem onSelect={() => go("/connect")}>
            <Link2 className="text-muted-foreground" /> Connect socials
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            <KeyRound className="text-muted-foreground" /> Create token
          </CommandItem>
        </CommandGroup>

        {niches && niches.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Enqueue a run" className={KICKER}>
              {niches.flatMap((n) =>
                n.platforms.map((p) => (
                  <CommandItem
                    key={`${n.id}-${p}`}
                    value={`enqueue ${n.title} ${p}`}
                    onSelect={() => enqueue(n.id, p)}
                    className="data-[selected=true]:border-brand/30 border border-transparent"
                  >
                    <Play className="fill-brand/20 text-brand" />
                    <span className="font-medium">Enqueue {n.title}</span>
                    <CommandShortcut className="font-mono uppercase tracking-normal">
                      {p}
                    </CommandShortcut>
                  </CommandItem>
                )),
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2.5 text-[0.7rem] text-muted-foreground">
        <span className="font-mono tabular-nums">↑↓ navigate · ↵ select · esc close</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="relative flex size-2"
          >
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          marketer.sh
        </span>
      </div>
    </CommandDialog>
  );
}

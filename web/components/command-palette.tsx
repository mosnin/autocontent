"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
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
} from "@/components/ui/command";
import { useRunConfirm } from "@/components/run-confirm-dialog";
import { clientFetch } from "@/lib/client-fetcher";
import type { Niche, Platform } from "@/lib/types";

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
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/queue")}>
            <ListChecks /> Queue
          </CommandItem>
          <CommandItem onSelect={() => go("/connect")}>
            <Link2 /> Connect socials
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            <Settings /> Settings
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            <KeyRound /> Tokens
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go("/onboarding")}>
            <Plus /> Create niche
          </CommandItem>
          <CommandItem onSelect={() => go("/connect")}>
            <Link2 /> Connect socials
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            <KeyRound /> Create token
          </CommandItem>
        </CommandGroup>

        {niches && niches.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Niches">
              {niches.flatMap((n) =>
                n.platforms.map((p) => (
                  <CommandItem
                    key={`${n.id}-${p}`}
                    value={`enqueue ${n.title} ${p}`}
                    onSelect={() => enqueue(n.id, p)}
                  >
                    <Play /> Enqueue {n.title}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {p}
                    </span>
                  </CommandItem>
                )),
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        esc to close · enter to select
      </div>
    </CommandDialog>
  );
}

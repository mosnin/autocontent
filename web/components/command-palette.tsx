"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
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

const OPEN_EVENT = "marketer:open-command-palette";

/** Programmatic open — the shell's search pill / button calls this. */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

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
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
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
          <CommandItem onSelect={() => go("/dashboard")}>
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/queue")}>
            Queue
          </CommandItem>
          <CommandItem onSelect={() => go("/articles")}>
            Articles
          </CommandItem>
          <CommandItem onSelect={() => go("/connect")}>
            Connect socials
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            Settings
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/billing")}>
            Billing
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            Tokens
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions" className={KICKER}>
          <CommandItem onSelect={() => go("/onboarding")}>
            Create niche
          </CommandItem>
          <CommandItem onSelect={() => go("/articles?new=1")}>
            New article
          </CommandItem>
          <CommandItem onSelect={() => go("/connect")}>
            Connect socials
          </CommandItem>
          <CommandItem onSelect={() => go("/settings/tokens")}>
            Create token
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
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          marketer.sh
        </span>
      </div>
    </CommandDialog>
  );
}

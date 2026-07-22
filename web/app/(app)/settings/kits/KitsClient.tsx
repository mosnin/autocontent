"use client";

// Kits: user-level reusable skills injected into agent runtimes.
// design -> video direction · writing -> article voice · ad -> scaling
// strategy knobs the ads optimizer honors when proposing changes.

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/square/ui/badge";
import { Button } from "@/components/square/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/square/ui/card";
import { Input } from "@/components/square/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/square/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/square/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { clientFetch } from "@/lib/client-fetcher";
import type { Kit, KitKind } from "@/lib/types";

const KIND_META: Record<KitKind, { title: string; blurb: string; placeholder: string }> = {
  design: {
    title: "Design kits",
    blurb:
      "Your direction system for video — shot grammar, transitions, framing habits, signature touches. Injected into the scriptwriter and visual director on every render.",
    placeholder:
      "Open on the subject in motion, never a static establishing shot.\nCut on action. One signature slow push-in per video.\nAlways end scenes before the narration finishes the sentence.",
  },
  writing: {
    title: "Writing kits",
    blurb:
      "Your voice on the page — sentence rhythm, vocabulary, structures, banned cliches. Injected into the article pipeline's writers and QA.",
    placeholder:
      "Short declarative sentences. One-sentence paragraphs for emphasis.\nConcrete nouns over abstractions. Never use 'delve', 'unlock', 'landscape'.",
  },
  ad: {
    title: "Ad kits",
    blurb:
      "Your scaling strategy — the metrics and rules the ads optimizer honors when PROPOSING changes. The fail-closed spend guard and approval gate still rule every execution.",
    placeholder:
      "Scale winners aggressively while ROAS holds above target.\nNever scale a campaign twice in 48h. Kill creatives below 1% CTR after 5k impressions.",
  },
};

async function mutate(path: string, method: string, body?: unknown) {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export function KitsClient({ initial }: { initial: Kit[] }) {
  const [kits, setKits] = React.useState<Kit[]>(initial);
  const refresh = React.useCallback(async () => {
    setKits(await clientFetch<Kit[]>("/api/v1/kits"));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kits</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable skills that ride along with the agents — your operating
          system on top of the pipeline.
        </p>
      </div>

      <Tabs defaultValue="design">
        <TabsList>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="writing">Writing</TabsTrigger>
          <TabsTrigger value="ad">Ads</TabsTrigger>
        </TabsList>
        {(Object.keys(KIND_META) as KitKind[]).map((kind) => (
          <TabsContent key={kind} value={kind} className="space-y-4 pt-4">
            <p className="max-w-2xl text-sm text-muted-foreground">
              {KIND_META[kind].blurb}
            </p>
            <KitEditor kind={kind} onSaved={refresh} />
            <KitsTable
              kits={kits.filter((k) => k.kind === kind)}
              onChanged={refresh}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// Square UI "marketing-dashboard" template table anatomy, applied to each
// kind's kit list — same Table/TableRow/TableCell chrome as the
// tokens/webhooks lists, no toolbar (each list is already scoped to one
// kind by the surrounding Tab). Full content/rules preview moves into a
// hover tooltip on the name cell (same Tooltip used for the articles list
// error preview) since a table row has no room for the free-text block the
// old card rendered inline.
function KitsTable({
  kits,
  onChanged,
}: {
  kits: Kit[];
  onChanged: () => void;
}) {
  if (kits.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No kits yet for this kind.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-lg border bg-card flex flex-col">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs font-medium text-muted-foreground h-10">
                Name
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground h-10">
                Description
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground h-10">
                Default
              </TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground h-10 text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kits.map((kit) => (
              <KitRow key={kit.id} kit={kit} onChanged={onChanged} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function KitRow({ kit, onChanged }: { kit: Kit; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const preview = kit.content || "(empty)";
  const rulesPreview =
    kit.kind === "ad" && Object.keys(kit.rules).length > 0
      ? JSON.stringify(kit.rules, null, 2)
      : null;

  return (
    <TableRow className="border-b last:border-0 hover:bg-muted/30">
      <TableCell className="py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-sm font-medium underline decoration-dotted underline-offset-4">
              {kit.name}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="whitespace-pre-wrap break-words">{preview}</p>
            {rulesPreview && (
              <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px]">
                {rulesPreview}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="py-3 max-w-[320px] truncate text-sm text-muted-foreground">
        {kit.description || "—"}
      </TableCell>
      <TableCell className="py-3">
        {kit.is_default ? (
          <Badge variant="secondary">default</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-3 whitespace-nowrap text-right">
        <span className="flex items-center justify-end gap-1.5">
          {!kit.is_default && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() =>
                run(
                  () => mutate(`/api/v1/kits/${kit.id}`, "PUT", { is_default: true }),
                  "Set as default",
                )
              }
            >
              Make default
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() =>
              run(() => mutate(`/api/v1/kits/${kit.id}`, "DELETE"), "Kit deleted")
            }
          >
            Delete
          </Button>
        </span>
      </TableCell>
    </TableRow>
  );
}

function KitEditor({ kind, onSaved }: { kind: KitKind; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [rules, setRules] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Give the kit a name");
      return;
    }
    let parsedRules: Record<string, unknown> = {};
    if (kind === "ad" && rules.trim()) {
      try {
        parsedRules = JSON.parse(rules);
      } catch {
        toast.error("Rules must be valid JSON");
        return;
      }
    }
    setBusy(true);
    try {
      await mutate("/api/v1/kits", "POST", {
        kind,
        name: name.trim(),
        content,
        rules: parsedRules,
        is_default: false,
      });
      toast.success("Kit created");
      setName("");
      setContent("");
      setRules("");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">New {KIND_META[kind].title.toLowerCase().replace(/s$/, "")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`kit-name-${kind}`}>Name</Label>
          <Input
            id={`kit-name-${kind}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My signature style"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`kit-content-${kind}`}>The skill</Label>
          <Textarea
            id={`kit-content-${kind}`}
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={KIND_META[kind].placeholder}
          />
        </div>
        {kind === "ad" && (
          <div className="space-y-1.5">
            <Label htmlFor="kit-rules-ad">
              Rules (JSON — target_roas, scale_up_pct, scale_down_pct, max_daily_budget_usd)
            </Label>
            <Textarea
              id="kit-rules-ad"
              rows={3}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder='{"target_roas": 2.5, "scale_up_pct": 15, "max_daily_budget_usd": 200}'
            />
          </div>
        )}
        <Button onClick={create} disabled={busy}>
          Create kit
        </Button>
      </CardContent>
    </Card>
  );
}

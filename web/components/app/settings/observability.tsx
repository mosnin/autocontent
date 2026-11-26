"use client";

import Link from "next/link";
import { useState } from "react";
import { Callout, NotAllowed, Notice, Section, SwitchRow, useAllowed, usePending } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";

export type ObservabilityContent = "redacted" | "metadata";
export interface ObservabilitySettings {
  content: ObservabilityContent;
  updated_at?: string | null;
}

/**
 * The workspace's "Don't send AI content to our observability provider"
 * switch (docs/observability/braintrust.md, rule 4). Everyone sees it; only
 * people with security:manage change it. On: traces carry no prompt or output
 * text, only model, tokens, cost, timing and outcomes.
 */
export function ObservabilitySection({ initial, preview }: { initial: ObservabilitySettings | null; preview?: boolean }) {
  const canManage = useAllowed("security:manage");
  const [content, setContent] = useState<ObservabilityContent>(initial?.content ?? "redacted");
  const pending = usePending<"save">();
  const [saved, setSaved] = useState<string | null>(null);

  const save = (metadataOnly: boolean) =>
    void pending.run("save", async () => {
      setSaved(null);
      const next: ObservabilityContent = metadataOnly ? "metadata" : "redacted";
      if (!preview) await proxyFetch<ObservabilitySettings>("/api/v1/observability/settings", "PUT", { content: next });
      setContent(next);
      setSaved(metadataOnly ? "Saved. New traces carry no AI text." : "Saved. New traces carry masked AI text.");
    });

  return (
    <Section title="AI observability for this workspace">
      {initial === null ? (
        <Callout tone="attention">Couldn&apos;t load this setting right now. Nothing was changed.</Callout>
      ) : (
        <>
          <SwitchRow
            label="Don't send AI content to our observability provider"
            detail={
              <>
                Marketer traces its AI work to find and fix bad replies. Prompts and outputs are masked first (emails, phone numbers, card numbers and secrets are removed). With this on, traces keep only the model, tokens, cost, timing and outcomes. See{" "}
                <Link href="/legal/subprocessors" className="text-fg hover:underline">
                  subprocessors
                </Link>
                .
              </>
            }
            checked={content === "metadata"}
            onChange={save}
            disabled={!canManage || pending.busy !== null}
          />
          {!canManage && <NotAllowed className="mt-2">Owners and admins change this setting.</NotAllowed>}
          <div className="mt-2">
            <Notice ok={saved} error={pending.error} />
          </div>
        </>
      )}
    </Section>
  );
}

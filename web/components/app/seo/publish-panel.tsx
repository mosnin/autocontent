"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Callout, Card, Field, Input, Modal, Notice, Section, Segmented, StatusBadge, Time, useAllowed, usePending } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import { httpsOnly, publishLabel, type SeoArticle, SEO_PLUGIN_LABEL, validateMeta, type WordPressConnection } from "@/lib/seo";
import { WordPressConnectModal } from "./wordpress-connect";

type Mode = "draft" | "live" | "schedule";

/** <input type="datetime-local"> value for a Date, in the viewer's zone. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultWhen(a: SeoArticle): string {
  if (a.publish_at && a.publish_status === "scheduled") return localInput(new Date(a.publish_at));
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return localInput(d);
}

function problemsOf(a: SeoArticle): string[] {
  if (a.status !== "done" || !a.article_markdown) return ["The article isn't finished yet."];
  return Object.values(
    validateMeta({
      meta_title: a.meta_title ?? "",
      meta_description: a.meta_description ?? "",
      slug: a.slug ?? "",
      focus_keyword: a.focus_keyword ?? "",
      secondary_keywords: a.keywords ?? [],
    }),
  ).filter((x): x is string => Boolean(x));
}

/** Publish to WordPress: draft, live now, or scheduled. One focused sheet. */
export function PublishModal({ article, wordpress, open, onClose, initialMode }: { article: SeoArticle; wordpress: WordPressConnection; open: boolean; onClose: () => void; initialMode?: Mode }) {
  const router = useRouter();
  const live = Boolean(article.published_at);
  const [mode, setMode] = useState<Mode>(initialMode ?? (article.publish_status === "scheduled" ? "schedule" : live ? "live" : "draft"));
  const [when, setWhen] = useState(defaultWhen(article));
  const { busy, error, run } = usePending<"go">();
  const problems = problemsOf(article);
  const rescheduling = article.publish_status === "scheduled" && mode === "schedule";
  const site = wordpress.site_url?.replace(/^https:\/\//, "") ?? "your site";

  const go = () =>
    run("go", async () => {
      if (mode === "schedule") {
        const at = new Date(when);
        if (Number.isNaN(at.getTime())) throw new Error("Pick a date and time.");
        if (rescheduling) await proxyFetch(`/api/v1/articles/${article.id}/schedule`, "PATCH", { publish_at: at.toISOString() });
        else await proxyFetch(`/api/v1/articles/${article.id}/publish`, "POST", { mode: "live", publish_at: at.toISOString() });
      } else {
        await proxyFetch(`/api/v1/articles/${article.id}/publish`, "POST", { mode });
      }
      router.refresh();
      onClose();
    });

  const label = mode === "draft" ? (article.wp_post_id ? "Update draft" : "Send draft") : mode === "live" ? (live ? "Update live post" : "Publish now") : rescheduling ? "Move" : "Schedule";
  const options = [
    ...(live ? [] : [{ value: "draft" as const, label: "Draft" }]),
    { value: "live" as const, label: live ? "Update live" : "Publish now" },
    ...(live ? [] : [{ value: "schedule" as const, label: "Schedule" }]),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish to WordPress"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void go()} loading={busy === "go"} disabled={problems.length > 0}>
            {label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented label="How to publish" value={mode} onChange={setMode} options={options} className="w-full" />
        <p key={mode} className="ds-enter text-[13px] text-fg-muted">
          {mode === "draft"
            ? `Saves a draft on ${site} for a last look in WordPress. Nothing goes public.`
            : mode === "live"
              ? `Goes live on ${site} as soon as you confirm, with ${SEO_PLUGIN_LABEL[wordpress.seo_plugin ?? "none"]} fields filled in.`
              : `Goes live on ${site} at this time. If the article changes before then, it waits for you instead.`}
        </p>
        {mode === "schedule" && (
          <Field label="Publish at" hint="Your local time.">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        )}
        {problems.length > 0 && (
          <Callout tone="attention" title="Fix this first">
            {problems[0]}
          </Callout>
        )}
        {wordpress.can_publish === false && mode !== "draft" && <Notice error="The connected WordPress user can't publish. Reconnect with an Editor or Administrator." />}
        <Notice error={error} />
      </div>
    </Modal>
  );
}

/** The article's publishing state and its one next step. */
export function PublishPanel({ article, wordpress }: { article: SeoArticle; wordpress: WordPressConnection | null }) {
  const router = useRouter();
  const canPublish = useAllowed("content:publish");
  const canConnect = useAllowed("integration:connect");
  const [sheet, setSheet] = useState<"publish" | "connect" | null>(null);
  const { busy, error, run } = usePending<"unschedule">();
  const state = publishLabel(article);
  const connected = Boolean(wordpress?.connected);
  const link = httpsOnly(article.wp_post_url);

  if (article.status !== "done") return null;

  const unschedule = () =>
    run("unschedule", async () => {
      await proxyFetch(`/api/v1/articles/${article.id}/schedule`, "DELETE");
      router.refresh();
    });

  const primary = !connected ? (
    canConnect ? (
      <Button variant="primary" onClick={() => setSheet("connect")}>
        Connect WordPress
      </Button>
    ) : null
  ) : canPublish && !["publishing", "unknown"].includes(article.publish_status ?? "none") ? (
    <Button variant="primary" onClick={() => setSheet("publish")}>
      {article.publish_status === "scheduled" ? "Change time" : article.published_at ? "Update" : "Publish"}
    </Button>
  ) : null;

  return (
    <Section title="Publishing">
      <Card className="space-y-3 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {state ? <StatusBadge tone={state.tone}>{state.label}</StatusBadge> : <span className="font-medium">Not published</span>}
              {article.publish_status === "scheduled" && article.publish_at && <Time iso={article.publish_at} format={{ weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }} className="text-fg-muted" />}
            </div>
            <p className="truncate text-[12px] text-fg-muted">
              {connected ? `WordPress · ${wordpress?.site_url?.replace(/^https:\/\//, "")}` : "Connect a WordPress site to publish this article as a draft or a live post."}
            </p>
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-ds-accent hover:underline">
              View on WordPress <ExternalLink className="size-3" />
            </a>
          )}
          {article.publish_status === "scheduled" && canPublish && (
            <Button variant="ghost" onClick={() => void unschedule()} loading={busy === "unschedule"}>
              Cancel schedule
            </Button>
          )}
          {primary}
        </div>
        {article.publish_status === "unknown" && (
          <Callout tone="attention" title="We sent it and got no answer">
            Check WordPress before trying again, then say what happened in the <Link href="/inbox" className="text-ds-accent hover:underline">inbox</Link>.
          </Callout>
        )}
        {(article.publish_status === "failed" || article.publish_status === "needs_review") && article.publish_error && <Notice error={article.publish_error} />}
        {connected && !canPublish && <p className="text-[12px] text-fg-muted">Owners, admins and marketers publish articles.</p>}
        <Notice error={error} />
      </Card>
      {connected && wordpress && sheet === "publish" && <PublishModal article={article} wordpress={wordpress} open onClose={() => setSheet(null)} />}
      {sheet === "connect" && <WordPressConnectModal open current={wordpress} onClose={() => setSheet(null)} />}
    </Section>
  );
}

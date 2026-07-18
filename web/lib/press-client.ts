// Client-safe typed client for the Press API (/api/v1/press). Reads go
// through SWR with `clientFetch` (see lib/client-fetcher.ts); writes POST/
// DELETE through the same /api/proxy/... handler so the Clerk JWT is
// attached server-side. No server-only imports — this runs in the browser.

import { ApiError, clientFetch } from "@/lib/client-fetcher";
import type {
  ArticlePublish,
  ArticleResearch,
  LinkOpportunity,
  PublishTarget,
  PublishTargetKind,
  TopicProposal,
  TopicStatus,
} from "@/lib/types";

const PRESS = "/api/v1/press";

export const pressKeys = {
  topics: (opts?: { status?: TopicStatus; niche_id?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.niche_id) params.set("niche_id", opts.niche_id);
    params.set("limit", String(opts?.limit ?? 200));
    return `${PRESS}/topics?${params.toString()}`;
  },
  targets: () => `${PRESS}/targets`,
  links: () => `${PRESS}/links`,
  articlePublishes: (articleId: string) =>
    `${PRESS}/articles/${encodeURIComponent(articleId)}/publishes`,
  research: (articleId: string) =>
    `/api/v1/articles/${encodeURIComponent(articleId)}/research`,
};

export const topicsFetcher = clientFetch<TopicProposal[]>;
export const targetsFetcher = clientFetch<PublishTarget[]>;
export const linksFetcher = clientFetch<LinkOpportunity[]>;
export const researchFetcher = clientFetch<ArticleResearch>;
export const articlePublishesFetcher = clientFetch<ArticlePublish[]>;

async function proxyMutate<T>(
  path: string,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method,
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || `${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return undefined as T;
}

/** One metered LLM call. 402 when the channel's daily cap is spent, 502 on
 *  an LLM/provider failure. */
export function generateTopics(
  niche_id: string,
  n?: number,
): Promise<TopicProposal[]> {
  return proxyMutate<TopicProposal[]>(`${PRESS}/topics/generate`, "POST", {
    niche_id,
    ...(n ? { n } : {}),
  });
}

export function approveTopic(id: string): Promise<TopicProposal> {
  return proxyMutate<TopicProposal>(`${PRESS}/topics/${id}/approve`, "POST");
}

export function rejectTopic(id: string): Promise<TopicProposal> {
  return proxyMutate<TopicProposal>(`${PRESS}/topics/${id}/reject`, "POST");
}

export interface CreateTargetInput {
  kind: PublishTargetKind;
  name: string;
  base_url: string;
  username?: string;
  secret: string;
}

export function createTarget(input: CreateTargetInput): Promise<PublishTarget> {
  return proxyMutate<PublishTarget>(`${PRESS}/targets`, "POST", input);
}

export function deleteTarget(id: string): Promise<void> {
  return proxyMutate<void>(`${PRESS}/targets/${encodeURIComponent(id)}`, "DELETE");
}

/** 409 when the article isn't finished yet or the target is disabled; 502
 *  when the outbound publish call itself fails. */
export function publishArticle(
  articleId: string,
  targetId: string,
): Promise<ArticlePublish> {
  return proxyMutate<ArticlePublish>(
    `${PRESS}/articles/${encodeURIComponent(articleId)}/publish`,
    "POST",
    { target_id: targetId },
  );
}

/** Turn an ApiError (or any thrown value) from this client into copy a user
 *  can read. Mirrors the humanizing convention in lib/actions.ts. */
export function humanizePressError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.message.replace(/^\d+\s*/, "");
    if (e.status === 402) {
      return "Daily spend cap reached for this channel. Wait for it to reset or raise the cap in the channel's settings.";
    }
    if (e.status === 502) {
      return "That didn't go through on the provider's end. Try again in a moment.";
    }
    if (e.status === 409) {
      return extractDetail(body) ?? "That can't be done right now.";
    }
    if (e.status === 429) {
      return "Too many requests right now. Give it a moment, then try again.";
    }
    if (e.status >= 500) {
      return "Something went wrong on our end. Try again in a moment.";
    }
    return extractDetail(body) ?? body ?? `Request failed (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

function extractDetail(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { detail?: string | Array<{ msg?: string }> };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) {
      return parsed.detail[0].msg ?? null;
    }
  } catch {
    // Not JSON — fall through.
  }
  return null;
}

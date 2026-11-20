import type { AnyAgentTool } from "@agent-starter/core";
import * as v from "valibot";
import { limit, seg, uuid } from "../api.ts";
import { readTool, writeTool } from "./define.ts";
import { getBrandKit, listPlaybooks } from "./strategy.ts";

/**
 * SEO department: long-form articles (an eight-step pipeline: research → outline → write → QA → metadata → image)
 * and repurposing finished articles into platform-native social snippets. Endpoints: /articles.
 *
 * Risk: reads LOW; writing, retrying and repurposing (metered AI calls charged to the playbook's daily cap) MEDIUM.
 * Repurposing returns text only: nothing is posted.
 */

const ARTICLE_STATUS = v.picklist(["queued", "researching", "outlining", "writing", "qa", "metadata", "imaging", "done", "failed"]);
const SOCIAL_PLATFORM = v.picklist(["twitter", "linkedin", "instagram", "facebook", "newsletter"]);

export const listArticles = readTool({
  name: "list_articles",
  description: "List articles, newest first, optionally by status or playbook.",
  input: v.object({ status: v.optional(ARTICLE_STATUS), playbookId: v.optional(uuid("playbookId")), limit: limit(200, 20) }),
  request: ({ status, playbookId, limit: n }) => ({ method: "GET", path: "/articles", query: { status_filter: status, niche_id: playbookId, limit: n } }),
});

export const getArticle = readTool({
  name: "get_article",
  description: "Read one article's metadata: topic, title, slug, keywords, status, error.",
  input: v.object({ articleId: uuid("articleId") }),
  request: ({ articleId }) => ({ method: "GET", path: `/articles/${seg(articleId)}` }),
});

export const getArticleMarkdown = readTool({
  name: "get_article_markdown",
  description: "Read a finished article's full markdown (long: use expand_tool_output for exact passages).",
  input: v.object({ articleId: uuid("articleId") }),
  maxOutputChars: 40_000,
  request: ({ articleId }) => ({ method: "GET", path: `/articles/${seg(articleId)}/markdown` }),
});

export const createArticle = writeTool({
  name: "create_article",
  description: "Write a new SEO article for a playbook (spends content credits). Leave topic empty to let the pipeline pick the next best topic, deduplicated against recent articles.",
  input: v.object({ playbookId: uuid("playbookId"), topic: v.optional(v.pipe(v.string(), v.maxLength(500)), "") }),
  risk: "MEDIUM",
  request: ({ playbookId, topic }) => ({ method: "POST", path: "/articles", body: { niche_id: playbookId, topic } }),
});

export const repurposeArticle = writeTool({
  name: "repurpose_article",
  description: "Turn a FINISHED article into platform-native social posts (a metered AI call; returns text snippets, posts nothing). Empty platforms = all.",
  input: v.object({ articleId: uuid("articleId"), platforms: v.optional(v.pipe(v.array(SOCIAL_PLATFORM), v.maxLength(10)), []) }),
  risk: "MEDIUM",
  sideEffect: "external",
  timeoutMs: 60_000,
  request: ({ articleId, platforms }) => ({ method: "POST", path: `/articles/${seg(articleId)}/social`, body: { platforms } }),
});

export const retryArticle = writeTool({
  name: "retry_article",
  description: "Re-run a FAILED article (spends content credits again).",
  input: v.object({ articleId: uuid("articleId") }),
  risk: "MEDIUM",
  request: ({ articleId }) => ({ method: "POST", path: `/articles/${seg(articleId)}/retry` }),
});

/** The SEO editor's department tools. */
export function seoTools(): AnyAgentTool[] {
  return [listArticles, getArticle, getArticleMarkdown, createArticle, repurposeArticle, retryArticle, listPlaybooks, getBrandKit];
}

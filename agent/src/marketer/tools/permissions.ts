import type { Permission } from "../../lib/permissions.ts";

/**
 * Marketer tool → the catalog permission its backend route needs (docs/auth/agent.md, "Tools"). One entry per tool in
 * src/marketer/tools/**; `test/permissions.test.ts` fails when a tool has no entry or an entry names a permission the
 * catalog does not have.
 *
 * The backend stays the authority (backend/policy.py classifies every route and caps the agent at agent ∩ the actor's
 * role). This table lets the agent refuse early, before an approval parks and before anything is sent, with a sentence
 * the person understands (src/marketer/actor.ts).
 *
 * Where a tool reaches a route that several permissions could guard, the stricter one wins: raising a playbook's spend
 * cap is `spend:set_limits` (only owners and admins set caps), not `playbook:update`.
 */
export const TOOL_PERMISSIONS: Readonly<Record<string, Permission>> = Object.freeze({
  // workspace
  get_workspace_overview: "workspace:read",
  get_workspace_inbox: "workspace:read",
  get_workspace_activity: "workspace:read",
  decide_inbox_item: "content:approve",
  // strategy
  list_playbooks: "playbook:read",
  get_playbook: "playbook:read",
  get_playbook_performance: "analytics:read",
  draft_playbook: "playbook:create",
  create_playbook: "playbook:create",
  update_playbook: "playbook:update",
  set_playbook_spend_cap: "spend:set_limits",
  get_brand_kit: "brand:read",
  update_brand_kit: "brand:update",
  list_kits: "brand:read",
  // content
  list_videos: "content:read",
  get_video: "content:read",
  get_video_metrics: "analytics:read",
  create_video: "content:create",
  retry_video: "content:update",
  list_carousels: "content:read",
  get_carousel: "content:read",
  create_carousel: "content:create",
  retry_carousel: "content:update",
  list_library_assets: "content:read",
  list_templates: "content:read",
  remix_template: "content:create",
  list_short_videos: "content:read",
  get_short_video: "content:read",
  create_short_video: "content:create",
  // seo
  list_articles: "content:read",
  get_article: "content:read",
  get_article_markdown: "content:read",
  create_article: "content:create",
  repurpose_article: "content:create",
  retry_article: "content:update",
  // distribution
  get_calendar: "content:read",
  list_campaigns: "campaign:read",
  get_campaign: "campaign:read",
  create_campaign: "campaign:create",
  start_campaign: "campaign:launch",
  pause_campaign: "campaign:pause",
  get_channel_status: "integration:read",
  start_channel_connection: "integration:connect",
  approve_video: "content:approve",
  reject_video: "content:approve",
  approve_carousel: "content:approve",
  // paid media
  get_ads_overview: "analytics:read",
  list_ad_accounts: "integration:read",
  list_ad_campaigns: "campaign:read",
  get_ad_campaign: "campaign:read",
  list_ad_approvals: "spend:read",
  list_ad_actions: "campaign:read",
  connect_ad_account: "integration:connect",
  create_ad_campaign: "campaign:create",
  set_ad_budget: "spend:approve",
  activate_ad_campaign: "campaign:launch",
  pause_ad_campaign: "campaign:pause",
  decide_ad_approval: "spend:approve",
  // analytics
  get_spend_today: "spend:read",
  get_spend_history: "spend:read",
  get_metrics_summary: "analytics:read",
  // proposals (the autopilot hands a plan to the web app for a person to approve; it does not reach a backend route)
  propose_next_moves: "agent:chat",
});

export function toolPermission(tool: string): Permission | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_PERMISSIONS, tool) ? TOOL_PERMISSIONS[tool] : undefined;
}

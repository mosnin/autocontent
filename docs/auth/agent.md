# Roles in the agent harness

The agent harness (`agent/`, Cloudflare Workers and Flue) enforces the same permission catalog as the web app and the backend: [`permissions.json`](./permissions.json). This page covers what the agent does with the session token, which permission guards each route and tool, and who a run acts for. The architecture is in the [README](./README.md).

## The session token

The web app mints the agent token (`web/lib/security/agent-token.ts`) in the agent-starter HMAC format:

| Claim | Value |
|---|---|
| `sub` | person id |
| `tid` | tenant id |
| `roles` | `[<workspace role>]`: `owner`, `admin`, `marketer`, `analyst` or `billing` |
| `scopes` | that role's permissions as `resource:action` strings |

`agent/src/lib/permissions.ts` is a typed copy of the catalog. `test/permissions.test.ts` fails if it differs from `permissions.json`.

A permission counts only when both hold:

- one of the token's roles is a person role in the catalog that grants it;
- the permission is in `scopes`.

A role the catalog doesn't know (the starter's old `operator` or `security`) adds nothing. So does a scope the role doesn't grant, or the `agent` system role on a person's token.

Machine identities keep their own roles and are unaffected: `agent` (delegated workers, bus, persistent agents), `system` (background jobs), `room`, `visitor` (widget tokens, refused everywhere here).

Two helpers express a check:

- `rolesGranting(permission)` gives the assignable roles that grant a permission, highest rank first. It is used for role lists handed to vendored routes, which only see roles.
- `hasScope(claims, permission)` checks role and scope together. It is used in our own code.

Don't hard-code a role name anywhere in `agent/src`.

## Routes

Each role-gated route needs one permission. They are defined in `agent/src/lib/access.ts`.

| Route | Permission | Roles today | How |
|---|---|---|---|
| `POST /approvals/by-id/:conversationId/:approvalId` (decide a parked approval) | `agent:approve` | owner, admin, marketer | `createApprovalRoutes({ operatorRoles })` |
| `/api/jobs*` (start, status, pause, resume, teardown) | `security:manage` | owner, admin | `hasScope` in `background/routes.ts` |
| `/api/dlq*` (list, replay, purge dead letters) | `security:manage` | owner, admin | `hasScope` |
| `/agents/background-worker/*` (any job conversation of the tenant) | `security:manage` | owner, admin | `agentAuth({ adminRoles })` |
| `/api/persistent/:id` create (`PUT …/config` at version 0) | `security:manage` | owner, admin | `creatorRoles` |
| `/api/persistent/:id` manage any autopilot (state, proposals, kill switch, memory) | `security:manage` | owner, admin | `adminRoles` (the autopilot's own owner can manage it too) |
| `/api/persistent/:id/audit` | `audit:read` | owner, admin | `securityRoles` |
| `GET /api/rooms/:id`, `/live` (any room of the tenant) | `audit:read` | owner, admin | `hasScope` in `multi-agent/routes.ts` |
| `POST /api/pusher/auth` (any run or room channel of the tenant) | `audit:read` | owner, admin | `hasScope` in `lib/pusher-auth.ts` |

Rooms and live channels stay open to the person who owns the conversation, whatever their role. Every route still requires the session's own tenant. Restricted tokens (widget visitor, voice, conversation-bound `cid`) are refused as before.

`pnpm seed:dev --token` mints an `owner` token with the owner's scopes, read from `docs/auth/permissions.json`.

## The actor

The actor is the person a run acts for. It comes from one place: the verified session that agentAuth turned into the conversation's `initialData`. The code is in `agent/src/marketer/actor.ts`.

| Run | Actor |
|---|---|
| Assistant, copilot, orchestrator (the person's own conversation) | the token's `sub`, `roles`, `scopes` (`usePersonActor`) |
| Department in a delegated task | the requester's actor, stamped by its delegation dispatch (`actorDispatch`) on the worker conversation it creates, and read only in a `-dlg.` conversation created by an agent (`useDelegatedActor`) |
| Department in a bus or room conversation | none |
| Background jobs (queued events and `POST /api/jobs`), the autopilot, the eval harness | none |
| MCP (OAuth client) | the grant's user and roles. The permissions are the ones the catalog gives those roles, because the grant carries no scopes. |

When there is an actor, the API client (`agent/src/marketer/api.ts`) sends `x-actor-id: <sub>` with the service token and `x-tenant-id`. The backend then caps the call at agent ∩ that person's role. Without an actor, no header is sent, and the backend gives the agent role minus `spend:approve` and `campaign:launch`.

The actor can't be chosen by the model, a tool argument, a bus message or a room turn:

- It rides on the tool context under a module-private symbol that `withActor` sets on every call. Tool arguments are JSON, and a string key such as `services.marketerActor` is ignored.
- A department honours a stamped actor only in a delegated-task conversation that an agent's dispatch created. Bus and room conversations ignore it.
- Flue applies `initialData` only when a conversation is created. A worker conversation belongs to exactly one requester conversation, so the stamp can't change hands.

A person whose id can't be carried in a header, or a stamp that isn't a person, gets a blocked actor. Every Marketer tool is refused. It never falls back to the broader unattended set.

## Tools

Every tool under `agent/src/marketer/tools/**` maps to the permission its backend route needs: `TOOL_PERMISSIONS` in `agent/src/marketer/tools/permissions.ts`. `test/permissions.test.ts` fails when a tool has no entry or an entry isn't in the catalog.

Before a tool runs, the run's permissions are checked:

- with an actor: agent ∩ the person's permissions;
- without one: the agent role minus `spend:approve` and `campaign:launch`.

Agents compose `actorPolicy(actor, …)` into `useAgentStarter({ policy })`, so the check runs before an approval parks. `withActor` checks again inside the tool. A refusal is `DENIED` with a plain sentence, and nothing is sent:

> DENIED: Your role (Analyst) can't launch campaigns. Ask an owner, admin or marketer. Nothing was sent. Do not retry; tell the person.

Reads are checked the same way. For example, Billing can't read playbooks. The backend stays the authority; this check is defense in depth and gives a clearer message.

| Permission | Tools |
|---|---|
| `workspace:read` | get_workspace_overview, get_workspace_inbox, get_workspace_activity |
| `playbook:read` | list_playbooks, get_playbook |
| `playbook:create` | draft_playbook, create_playbook |
| `playbook:update` | update_playbook |
| `brand:read` | get_brand_kit, list_kits |
| `brand:update` | update_brand_kit |
| `content:read` | list_videos, get_video, list_carousels, get_carousel, list_library_assets, list_templates, list_articles, get_article, get_article_markdown, get_calendar |
| `content:create` | create_video, create_carousel, remix_template, start_story_video, revise_story_video, storyboard_story_video, render_story_video, create_article, repurpose_article |
| `content:update` | retry_video, retry_carousel, retry_article |
| `content:approve` | decide_inbox_item, approve_video, reject_video, approve_carousel |
| `campaign:read` | list_campaigns, get_campaign, list_ad_campaigns, get_ad_campaign, list_ad_actions |
| `campaign:create` | create_campaign, create_ad_campaign |
| `campaign:launch` | start_campaign, activate_ad_campaign |
| `campaign:pause` | pause_campaign, pause_ad_campaign |
| `spend:read` | get_spend_today, get_spend_history, list_ad_approvals |
| `spend:approve` | set_ad_budget, decide_ad_approval |
| `spend:set_limits` | set_playbook_spend_cap |
| `analytics:read` | get_playbook_performance, get_video_metrics, get_ads_overview, get_metrics_summary |
| `integration:read` | get_channel_status, list_ad_accounts |
| `integration:connect` | start_channel_connection, connect_ad_account |
| `agent:chat` | propose_next_moves (hands a plan to the web app; no backend route) |

### Tools the agent can't run

The catalog's `agent` role doesn't hold `brand:update`, `spend:set_limits` or `integration:connect`. So `update_brand_kit`, `set_playbook_spend_cap`, `start_channel_connection` and `connect_ad_account` are refused for everyone, whatever their role, and the person does it in the app. `test/permissions.test.ts` pins this list. Changing it means changing the agent role in `permissions.json`, or retiring the tools.

## Approvals

- Departments bind HIGH and CRITICAL approvals to the actor (`approverId: actor?.id ?? tenantId`), so the person who started the task can approve by link in their own session. With no actor, the approval is bound to the tenant id, which no session holds.
- Anyone whose role grants `agent:approve` (owner, admin, marketer) can decide any parked approval of their workspace by id. This closes finding 15 of `docs/security/agent-audit.md`: an owner can decide a department's HIGH or CRITICAL call.
- After approval the call still runs as the actor who started it, and the backend still checks agent ∩ their role.
- The decider's own permissions aren't compared with the tool's. A marketer can approve a parked call that only an admin could have started. See the open findings in the stream report.

## Known limits

- Roles reach an existing conversation only when it is created (Flue `initialData`). A role change applies to new conversations; the backend checks live membership on every call.
- MCP grants carry roles, not scopes, and last up to the refresh-token lifetime. The backend's live check is the authority.
- Rooms and bus conversations started from a person's conversation drop the person. Their departments run as the unattended agent, and anything above LOW still waits for a person's approval.

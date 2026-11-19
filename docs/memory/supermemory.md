# Supermemory: personal and team recall

Marketer's agents remember through two layers:

| Layer | What it holds | Who governs it |
|---|---|---|
| **Facts and learnings** (Postgres, [README](./README.md)) | Typed facts about the brand, audience, offers, rules; learnings with evidence | Code: trust levels, a review queue, and only a person can confirm, correct or forget |
| **Recall** (Supermemory v5) | What a person told Marketer in conversation, a maintained profile of each person, and semantic search over the workspace's governed knowledge | The rules below |

Supermemory makes recall better: semantic search, a profile that updates as preferences change, and conversation memory across sessions. It never becomes the source of a rule or a brand claim. Those stay in Postgres, behind the review queue.

Supermemory is **off by default** and turned on per workspace by someone with `security:manage`, because it is a subprocessor that receives text. With it off, Marketer behaves exactly as before.

## Two scopes

| | Personal | Team |
|---|---|---|
| Subject | One person in one workspace | One workspace |
| Holds | That person's own conversations with Marketer, and the profile derived from them | Confirmed facts, the brand kit, playbooks and published content, mirrored from Postgres |
| Read by | **Only that person**, and the agent while acting for them. Not owners, not admins, not platform staff. | Members with `memory:read`, and the agent acting for any member or for the workspace |
| Written by | The agent, from that person's own turns | Only by mirroring governed sources. **Conversations never go to team memory.** |
| Forget | The person, from Memory → Personal | `memory:forget` (owner, admin), or forgetting the Postgres fact it mirrors |
| Deleted when | The person leaves the workspace, or deletes their account | The workspace is deleted or erased |

The rule behind the split: **default private.** Something a person says to Marketer stays theirs. A business fact reaches teammates only after it passes the existing review queue and a person with `memory:confirm` confirms it.

Background and autopilot runs, which have no person behind them, read team memory only and write nothing.

## Namespaces

Supermemory isolates data by namespace. Marketer derives every namespace from verified identity, in exactly one function on each side:

```
team:     "mkt-t-" + hex(HMAC-SHA256(MEMORY_NAMESPACE_SECRET, "v1|team|"   + tenantId))[0:40]
personal: "mkt-p-" + hex(HMAC-SHA256(MEMORY_NAMESPACE_SECRET, "v1|person|" + tenantId + "|" + personId))[0:40]
```

- **Opaque to the vendor.** No ids, emails or names appear in a namespace.
- **Not guessable.** Without the secret, knowing someone's id doesn't give you their namespace.
- **Identity, never input.** The agent derives namespaces from its verified session token (`tid`, `sub`); the backend from `AuthCtx` (`user_id` = tenant, `actor_id` = person). No tool argument, model output, request body, bus message or URL ever names a namespace. A guard test fails if any other module builds a `/ns/` path.
- **Ids containing `|` are refused** rather than derived.
- **Conformance vectors:** [`supermemory-namespaces.json`](./supermemory-namespaces.json). The agent and the backend both test against it, so they always derive the same namespace.
- **Rotation:** `v1` is part of the message. Rotating the secret means deriving `v2` namespaces and moving each one with `DELETE /ns/{old}?moveTo={new}`.

## What is sent, and what is not

Sent to personal memory:
- the person's message and Marketer's reply for each turn, after the existing secret redaction (`agent/src/marketer/memory/redact.ts`);
- one document per conversation (`id` = conversation id), so a conversation stays one evolving document;
- metadata: `scope`, `kind: "chat"`, `conversation`, `at`.

Sent to team memory:
- a confirmed fact when it is confirmed (removed when corrected or forgotten);
- the brand kit, playbooks and published content when they change.

Never sent:
- tool outputs, fetched web pages or anything else marked untrusted;
- URLs as content (Supermemory would fetch them server-side);
- attachments, credentials or anything the redactor flags;
- one person's conversation into any namespace but their own personal one.

## Reading

Per turn, in parallel, inside a single time budget (fail open to no recall, because recall is UX, not money):

1. `profile(personal)` for standing preferences;
2. `search(personal, { query })`;
3. `search(team, { query })`.

Results are merged by score, trimmed to a character budget, and placed in the prompt inside `<untrusted_content source="memory">`. They were produced by a model and can't carry instructions.

## Lifecycle

| Event | What happens |
|---|---|
| Workspace turns Supermemory on | Team memory is seeded from confirmed facts, brand kit and playbooks. |
| Workspace turns it off | Reads and writes stop. The admin can also delete all of the workspace's namespaces. |
| A member is removed | Their personal namespace in that workspace is deleted. A backend job consumes `member.removed` audit rows; it is idempotent and retries until Supermemory confirms. |
| A person deletes their account | Their personal namespaces in every workspace are deleted. |
| A workspace is deleted or erased | Its team namespace and every personal namespace in it are deleted. |
| Privacy export | A person's export includes their personal memories; a workspace export includes team memory. |

Deletion fails closed: it is recorded as pending and retried until Supermemory confirms it. Every forget and purge writes `memory.forget` or `memory.purge` to `security_audit_log`, with counts and namespace kind only, never content.

## Keys and endpoints

- `SUPERMEMORY_API_KEY`: a Cloudflare Worker secret (`wrangler secret put SUPERMEMORY_API_KEY`) and a backend environment variable. Use separate keys per environment. It never reaches the web app or the browser.
- `MEMORY_NAMESPACE_SECRET`: 32+ random bytes, the same value in the Worker and the backend.
- `SUPERMEMORY_BASE_URL`: optional. Set it to a self-hosted (`supermemory local`) or enterprise endpoint for workspaces that can't send data to the hosted service.
- The agent's egress allowlist includes the Supermemory host; nothing else in the agent can reach it.

## Limits to know

- **The API key is organization-wide.** Supermemory supports keys scoped to namespaces, but they can't yet be minted per session through the API, so isolation rests on Marketer deriving namespaces correctly. That is why derivation lives in one function per side, is tested against shared vectors, and is guarded against bypass.
- **Supermemory sees plaintext.** It has to, to extract memories. Their documentation states AES-256 at rest, TLS 1.3 in transit, SOC 2 and GDPR. Workspaces that need data to stay in their own infrastructure should use the self-hosted endpoint.
- **Memory formation is asynchronous.** A new fact can take minutes to appear in the profile. Mirrors of confirmed facts use `dreaming: "instant"` so teammates see them right away.

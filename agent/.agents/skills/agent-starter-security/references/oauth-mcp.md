# OAuth 2.1 + exposing tools as an MCP server

The pieces:
- Code: `packages/cloudflare/src/oauth.ts` and `packages/cloudflare/src/mcp.ts`.
- Generated wiring (in-app module): `src/in-app/oauth-mcp.ts`, `src/in-app/app-api.ts`.
- Binding: KV `OAUTH_KV`, created by `scripts/init-cloudflare-infra.sh` and declared in `wrangler.jsonc`.

## Endpoints (all served by `createAgentOAuthProvider`)
| Path | Purpose |
|---|---|
| `/.well-known/oauth-authorization-server` | AS metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource` | Resource metadata (RFC 9728): `resource = ${PUBLIC_BASE_URL}/mcp`, `authorization_servers = [issuer]` |
| `/oauth/register` | Dynamic client registration |
| `/authorize` | `defaultHandler` → `createConsentHandler` (your consent page) |
| `/oauth/token` | Code exchange with PKCE S256 and refresh-token rotation. Access tokens last 1 h, refresh tokens 30 d |
| `/mcp` (`apiRoute`) | Protected resource. Requests without a valid token get 401 |

`src/in-app/oauth-mcp.ts` routes `/mcp`, `/authorize`, `/oauth/*` and `/.well-known/*` from Hono into one
lazily-created provider.

## Consent (`createConsentHandler`)
1. The handler reads the SaaS session from the `agent_session` cookie only (a `?session=` query token would leak into logs, history and Referer headers, so it is ignored). It verifies it with `sessionSecret(env)`; widget visitor and voice tokens are refused. No session → 302 to `loginUrl(returnTo)`.
2. **GET:** `parseAuthRequest` → `describeConsent` → `beginConsent`. Then it renders an HTML page:
   - every client-supplied string is escaped;
   - it shows the redirect URI and whether the client domain is verified;
   - scopes appear as checkboxes.
3. **POST:**
   - `deny` → `denyConsent`.
   - `approve` → `approveConsent(request, handle, { scope })` → `completeAuthorization({ userId: "<tid>/<sub>", metadata: { tenantId }, scope, props: { tenantId, userId, roles } })` → redirect.
4. Grant `props` are the **only** identity source for MCP calls. They come from your session, never from the client.

## Protected handler and scopes
```ts
apiHandler: {
  fetch: (request, env, ctx) => {
    const auth = (ctx as unknown as { auth?: OAuthResourceAuth }).auth;
    if (!auth) return new Response("Unauthorized", { status: 401 }); // fail closed (the generated file does the same)
    const denied = requireScopes(auth, ["mcp:tools"]); // → 403 insufficient_scope with step-up hint
    if (denied) return denied;
    return mcp(request, env, ctx);
  },
},
```
`scopesSupported` (`["mcp:tools", "offline_access"]` in the example) is advertised but **not enforced** by the
provider. `requireScopes` is what enforces it.

## MCP server (`createToolMcpHandler`)
```ts
const mcp = createToolMcpHandler({
  name: "agent-starter-copilot",
  version: "1.0.0",
  tools: appApiTools().filter((t) => t.name !== "navigate_ui"),
  // A factory: a fresh firewall (quota counters) per MCP call and caller.
  executor: (caller) => ({ firewall: new ToolFirewall(appApiFirewall) /* + budget, telemetry, audit */ }),
  resolveCaller: async (props) => {
    const tenantId = String(props.tenantId ?? ""), userId = String(props.userId ?? "");
    if (!tenantId || !userId) throw new Error("Missing OAuth grant props");
    return { tenant: { tenantId, userId, environment: "production", roles: [], scopes: [] }, tenantConfig: await tenantConfigs().get(tenantId) };
  },
});
```
How a `tools/call` is handled:
- Each call builds a `McpServer` per request; it uses the Agents SDK `createMcpHandler` and MCP SDK v2.
- `withJsonSchema(tool.input)` advertises the input schema. Annotations follow `sideEffect`: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
- Each `tools/call` reads `getMcpAuthContext().props`, calls `resolveCaller`, builds a `ToolExecutor` from `executor(caller)` (or the static options), then calls `execute()` with:
  - `runId mcp:<tenant>:<user>`;
  - a random call id `mcp_<uuid>`;
  - `mode: "live"`.
- Any outcome other than `ok`/`simulated` returns `isError: true` with the outcome JSON.

Caveats:
- **Pass `executor` as a factory.** A static options object is shared, so a `ToolFirewall` inside it would count calls across **all** callers until the isolate dies. With `executor: (caller) => ({ ... })` the quotas are per call. Implement longer-lived per-tenant quotas with `TokenBucketRateLimiter` keyed by tenant in `apiHandler`.
- **No approvals over MCP.** Without `approvals`, HIGH/CRITICAL tools return a pending result that can never be approved. With `approvals`, every call has a fresh random id, so a decision never matches a later call. Treat HIGH/CRITICAL tools as "not available over MCP": filter them out of `tools`, or add them to the firewall `deny`.
- **Budget accounting.** `resolveCaller` should load the real `TenantConfig`, so tenant `deniedTools`/`allowedTools` apply. Add `budget: new BudgetGuard({...})` to `executor` if MCP calls should count against a ledger.

## Local test
```bash
curl -i $BASE/mcp                                    # 401 + WWW-Authenticate (resource metadata)
curl -s $BASE/.well-known/oauth-protected-resource   # { "resource": ".../mcp", ... }
npx @modelcontextprotocol/inspector                  # connect to $BASE/mcp, complete OAuth with a SaaS session cookie
```

import { type SessionClaims, verifySessionToken } from "@agent-starter/core";
import OAuthProvider, { insufficientScope, type OAuthHelpers, type OAuthResourceAuth } from "@cloudflare/workers-oauth-provider";

export interface AgentOAuthOptions<Env> {
  /** Protected API paths (e.g. ["/mcp", "/api/"]). Tokens are bound to `resource`. */
  apiRoute: string | string[];
  apiHandler: { fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> };
  /** Handles /authorize and every unprotected route (your Hono app). */
  defaultHandler: { fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> };
  scopesSupported: string[];
  /** Exact URL MCP/API clients connect to (RFC 8707 resource indicator). */
  resource: string;
  issuer?: string;
  accessTokenTTL?: number;
  refreshTokenTTL?: number;
}

/**
 * OAuth 2.1 authorization server + resource protection for the agent backend
 * (PKCE S256, dynamic client registration, refresh rotation, RFC 9728 protected
 * resource metadata). Requires a KV binding named `OAUTH_KV`. Use it to let
 * MCP clients and third-party apps call your agents' tools on behalf of a user.
 */
export function createAgentOAuthProvider<Env>(options: AgentOAuthOptions<Env>) {
  return new OAuthProvider<Env>({
    apiRoute: options.apiRoute,
    apiHandler: options.apiHandler as never,
    defaultHandler: options.defaultHandler as never,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: options.scopesSupported,
    resourceMetadata: { resource: options.resource, ...(options.issuer ? { authorization_servers: [options.issuer] } : {}) },
    accessTokenTTL: options.accessTokenTTL ?? 3600,
    refreshTokenTTL: options.refreshTokenTTL ?? 30 * 24 * 3600,
  } as never);
}

/** Scopes are advertised but not enforced by the provider: call this in protected handlers. */
export function requireScopes(auth: OAuthResourceAuth, scopes: string[]): Response | null {
  const missing = scopes.filter((s) => !auth.scope.includes(s));
  return missing.length ? insufficientScope(auth, missing) : null;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

/**
 * `/authorize` consent flow. The user must already be signed in to the host
 * SaaS: we verify the SaaS-minted session token from the session cookie (never
 * from the query string: URLs leak into logs, history and Referer headers;
 * widget visitor and voice tokens are refused), show a
 * consent page with every client-supplied string escaped, then complete the
 * authorization binding `props` (tenantId/userId) into the grant so protected
 * handlers know exactly whose data a token may touch.
 */
export function createConsentHandler<Env extends { OAUTH_PROVIDER: OAuthHelpers }>(options: {
  appName: string;
  /** Session token secret(s); pass `[current, previous]` while rotating. */
  sessionSecret: (env: Env) => string | string[];
  loginUrl: (returnTo: string) => string;
  sessionCookie?: string;
}) {
  const cookieName = options.sessionCookie ?? "agent_session";
  const readSession = async (request: Request, env: Env): Promise<SessionClaims | null> => {
    const cookie = request.headers.get("cookie") ?? "";
    const fromCookie = cookie.split(/;\s*/).find((c) => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    let token: string | null;
    try {
      token = fromCookie ? decodeURIComponent(fromCookie) : null;
    } catch {
      token = null;
    }
    try {
      return await verifySessionToken(options.sessionSecret(env), token);
    } catch {
      return null;
    }
  };

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });
      const session = await readSession(request, env);
      if (!session) return Response.redirect(options.loginUrl(url.toString()), 302);
      const oauth = env.OAUTH_PROVIDER;

      if (request.method === "GET") {
        const authRequest = await oauth.parseAuthRequest(request);
        const details = await oauth.describeConsent(authRequest);
        const consent = await oauth.beginConsent(authRequest);
        const scopes = details.scope.map((s) => `<li><label><input type="checkbox" name="scope" value="${escapeHtml(s)}" checked> ${escapeHtml(s)}</label></li>`).join("");
        const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${escapeHtml(details.clientName)}</title>
<style>body{font:15px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#111}button{padding:.6rem 1rem;border-radius:.5rem;border:1px solid #ccc;margin-right:.5rem}button[value=approve]{background:#111;color:#fff}</style></head>
<body><h1>${escapeHtml(details.clientName)} wants access to ${escapeHtml(options.appName)}</h1>
<p>Signed in as <strong>${escapeHtml(session.sub)}</strong> (workspace ${escapeHtml(session.tid)}). Tokens will be sent to <strong>${escapeHtml(details.redirectUri)}</strong>${details.clientDomain ? ` (verified domain ${escapeHtml(details.clientDomain)})` : " (unverified client)"}.</p>
<form method="post"><input type="hidden" name="handle" value="${escapeHtml(consent.handle)}"><ul>${scopes}</ul>
<button name="decision" value="approve">Allow</button><button name="decision" value="deny">Deny</button></form></body></html>`;
        const headers = new Headers(consent.headers);
        headers.set("content-type", "text/html; charset=utf-8");
        return new Response(html, { headers });
      }

      if (request.method === "POST") {
        const form = await request.formData();
        const handle = String(form.get("handle") ?? "");
        if (form.get("decision") !== "approve") {
          const denied = await oauth.denyConsent(request, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        const approved = await oauth.approveConsent(request, handle, { scope: form.getAll("scope").map(String) });
        const { redirectTo } = await oauth.completeAuthorization({
          request: approved.request,
          userId: encodeURIComponent(`${session.tid}/${session.sub}`),
          metadata: { tenantId: session.tid },
          scope: approved.request.scope,
          props: { tenantId: session.tid, userId: session.sub, roles: session.roles },
        });
        approved.headers.set("location", redirectTo);
        return new Response(null, { status: 302, headers: approved.headers });
      }
      return new Response("Method not allowed", { status: 405 });
    },
  };
}

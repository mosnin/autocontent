import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../env.ts";
import { APP_CONTEXT_HEADER } from "./app-context.ts";

const widgetOriginCache = new Map<string, { allowed: boolean; expiresAt: number }>();

/**
 * CORS origin policy (which origin may call which route). app.ts uses it through `agentCors`, which also
 * decides credentials per origin; call it directly only for custom middleware.
 *  - Any route: origins listed in ALLOWED_ORIGINS (your SaaS frontends).
 *  - Widget routes only (`widgetPaths`, e.g. /widget/ and the support agent mount):
 *    origins registered for a widget site in WIDGET_KEYS (`origin:<origin>` index
 *    written next to `widget:<publicKey>`). Preflights carry no body or token, so
 *    the origin index is what lets a customer's site through; POST /widget/session
 *    still checks the origin against the publishable key's own allowlist.
 */
export async function corsOrigin(origin: string, c: Context, widgetPaths: string[] = []): Promise<string | null> {
  if (!origin) return null;
  const env = c.env as Env;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (allowed.includes(origin)) return origin;
  if (!env.WIDGET_KEYS || !widgetPaths.some((p) => c.req.path.startsWith(p))) return null;
  return (await isWidgetOrigin(env.WIDGET_KEYS, origin)) ? origin : null;
}

export async function isWidgetOrigin(kv: KVNamespace, origin: string): Promise<boolean> {
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origin)) return false;
  const cached = widgetOriginCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;
  const value = await kv.get(`origin:${origin}`, { cacheTtl: 60 });
  const result = value !== null && value !== "";
  widgetOriginCache.set(origin, { allowed: result, expiresAt: Date.now() + 60_000 });
  return result;
}

const ALLOW_HEADERS = ["authorization", "content-type", APP_CONTEXT_HEADER];
const EXPOSE_HEADERS = ["Stream-Next-Offset", "Stream-Up-To-Date", "Location"];

const allowedOrigins = (env: Env) => (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);

/**
 * CORS middleware for app.ts (`app.use("*", agentCors(WIDGET_PATHS))`), SEC-13:
 *  - ALLOWED_ORIGINS (your SaaS frontends, which may use the session cookie): any route, with
 *    `Access-Control-Allow-Credentials: true`;
 *  - registered widget sites: widget routes only and WITHOUT credentials. Widget calls carry a Bearer
 *    visitor token, never cookies, so a customer's site can never ride a signed-in user's cookie.
 */
export function agentCors(widgetPaths: string[] = []): MiddlewareHandler {
  const options = { allowHeaders: ALLOW_HEADERS, exposeHeaders: EXPOSE_HEADERS };
  const trusted = cors({ ...options, credentials: true, origin: (origin, c) => (origin && allowedOrigins(c.env as Env).includes(origin) ? origin : null) });
  const widget = cors({
    ...options,
    credentials: false,
    origin: async (origin, c) => {
      const env = c.env as Env;
      if (!origin || !env.WIDGET_KEYS || !widgetPaths.some((p) => c.req.path.startsWith(p))) return null;
      return (await isWidgetOrigin(env.WIDGET_KEYS, origin)) ? origin : null;
    },
  });
  return async (c, next) => {
    const origin = c.req.header("origin") ?? "";
    return origin && allowedOrigins(c.env as Env).includes(origin) ? trusted(c, next) : widget(c, next);
  };
}

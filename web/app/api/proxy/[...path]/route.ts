// Server-side proxy that forwards browser requests under /api/proxy/...
// to the FastAPI backend, attaching a backend JWT minted here for the
// caller's session. Browser code (SWR hooks) can't mint one, and must never
// hold one: the token exists only between this function and the backend.
//
// It is not an open proxy. The policy lives in lib/security/proxy-policy.ts
// (tested in web/test/security.test.ts):
//  - the host is the configured backend origin, and only /api/v1/** is forwarded;
//  - signed-in callers only, and the token is attached here, never by the client;
//  - request headers are an allowlist; cookies and Set-Cookie never cross;
//  - mutations must be same-origin (CSRF) and bodies are size-capped.

import { NextRequest, NextResponse } from "next/server";
import { BodyTooLargeError, readBodyCapped } from "@/lib/security/body";
import { mintBackendToken } from "@/lib/auth/backend-token";
import { downstreamResponseHeaders, isSameOriginRequest, MAX_PROXY_BODY_BYTES, resolveUpstream, upstreamRequestHeaders } from "@/lib/security/proxy-policy";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const fail = (status: number, error: string) => NextResponse.json({ detail: error }, { status, headers: NO_STORE });

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (!isSameOriginRequest(req.method, req.headers)) return fail(403, "cross-origin request refused");

  const target = resolveUpstream(process.env.NEXT_PUBLIC_API_BASE_URL, path, req.nextUrl.search, { production: process.env.NODE_ENV === "production" });
  if (!target.ok) return fail(target.status, target.error);

  let token: string | null;
  try {
    token = await mintBackendToken();
  } catch {
    // The session store or the signing key is unavailable: refuse, never forward unauthenticated.
    return fail(503, "sign-in is unavailable, try again shortly");
  }
  if (!token) return fail(401, "sign in to continue");

  const init: RequestInit = {
    method: req.method,
    // Forwards Range so FastAPI FileResponse can serve 206 partial content:
    // Safari refuses to play <video> sources that ignore Range.
    headers: upstreamRequestHeaders(req.headers, token),
    cache: "no-store",
    // Pass redirects (e.g. the library's 307 to a presigned Wasabi URL)
    // back to the browser so media streams directly from object storage
    // instead of being piped through this function. This also means the
    // token is never re-sent to a host the backend redirects to.
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      // Binary-safe passthrough: forward the raw bytes, don't decode as text.
      const buf = await readBodyCapped(req, MAX_PROXY_BODY_BYTES);
      if (buf.byteLength > 0) init.body = buf;
    } catch (e) {
      if (e instanceof BodyTooLargeError) return fail(413, "request body is too large");
      return fail(400, "could not read the request body");
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.url, init);
  } catch {
    // Never echo the fetch error: it names the backend host.
    return fail(502, "the service is unreachable");
  }

  // Stream the upstream body straight through, never `.text()`: that
  // would corrupt binary responses (mp4, png, etc).
  return new NextResponse(upstream.body, { status: upstream.status, headers: downstreamResponseHeaders(upstream.headers.entries()) });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}

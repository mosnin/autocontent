// Server-side proxy that forwards browser requests under /api/proxy/...
// to the FastAPI backend, attaching the caller's Clerk JWT. We need
// this because `web/lib/api.ts` calls `auth()` which is only valid in
// server contexts, but our SWR hooks fetch from the browser.

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const { getToken } = await auth();
  const token = await getToken();
  const search = req.nextUrl.search;
  const url = `${BASE}/${path.join("/")}${search}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  // Forward Range so FastAPI FileResponse can serve 206 partial content —
  // Safari refuses to play <video> sources that ignore Range.
  const range = req.headers.get("range");
  if (range) headers["range"] = range;
  if (token) headers["authorization"] = `Bearer ${token}`;

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
    // Pass redirects (e.g. the library's 307 to a presigned Wasabi URL)
    // back to the browser so media streams directly from object storage
    // instead of being piped through this function.
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Binary-safe passthrough: forward the raw stream, don't decode as text.
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) init.body = buf;
  }

  const upstream = await fetch(url, init);

  // Stream the upstream body straight through — never `.text()` because
  // it would corrupt binary responses (mp4, png, etc).
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    // Drop hop-by-hop headers Next would otherwise strip anyway.
    const lk = k.toLowerCase();
    if (lk === "transfer-encoding" || lk === "connection") continue;
    respHeaders.set(k, v);
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
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

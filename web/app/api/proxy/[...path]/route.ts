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
  if (token) headers["authorization"] = `Bearer ${token}`;

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const upstream = await fetch(url, init);
  const body = await upstream.text();
  const resp = new NextResponse(body, { status: upstream.status });
  const upstreamCt = upstream.headers.get("content-type");
  if (upstreamCt) resp.headers.set("content-type", upstreamCt);
  return resp;
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

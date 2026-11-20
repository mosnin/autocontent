import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { api } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { mediaSlotById } from "@/lib/media-slots";
import { BodyTooLargeError, readJsonCapped } from "@/lib/security/body";
import { isSameOriginRequest } from "@/lib/security/proxy-policy";
import { createRateLimiter } from "@/lib/security/rate-limit";

// Runtime store for admin-uploaded media. Files live on the web server's
// disk (data/media under the app root) so uploads work anywhere `next
// start` runs on a node host; on ephemeral/serverless hosts uploads last
// until the instance recycles — the admin UI says so.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = path.join(process.cwd(), "data", "media");
const MANIFEST = path.join(STORE_DIR, "manifest.json");
const MAX_BYTES = 8 * 1024 * 1024;
/** Base64 inflates by 4/3; allow the 8 MB image plus the JSON envelope. */
const MAX_BODY_BYTES = Math.ceil((MAX_BYTES * 4) / 3) + 4096;
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

// Raster formats only. SVG is a document: served from this origin it can run
// script, so it is not accepted (stored XSS on the marketing site).
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The bytes must be the image type they claim to be. */
function sniff(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "image/webp";
  return null;
}

type Manifest = Record<string, { ext: string; type: string; updatedAt: number }>;

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

async function writeManifest(m: Manifest) {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(MANIFEST, JSON.stringify(m, null, 2));
}

/** Public: the slot → image manifest every page reads. */
export async function GET() {
  const manifest = await readManifest();
  return NextResponse.json(
    { slots: manifest },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * These images appear on the public site for everyone, so writing them is an
 * admin action, not a signed-in-user action. The backend owns the admin
 * decision: we ask it the same question the /admin layout asks. Any failure
 * (signed out, not an admin, backend down) is a refusal.
 */
async function requireAdmin(req: NextRequest): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const deny = (status: number, error: string, headers: Record<string, string> = {}) => ({ ok: false as const, res: NextResponse.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } }) });
  if (!isSameOriginRequest(req.method, req.headers)) return deny(403, "cross-origin request refused");
  let userId: string | null = null;
  try {
    userId = (await getSession())?.user.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return deny(401, "unauthorized");
  const hit = limiter.hit(userId);
  if (!hit.ok) return deny(429, "too many requests", { "retry-after": String(hit.retryAfterSeconds) });
  try {
    await api("/api/v1/admin/overview");
  } catch {
    return deny(403, "forbidden");
  }
  return { ok: true, userId };
}

/** Admin: upload/replace one slot. Body: { id, dataUrl }. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.res;
  let parsed: unknown;
  try {
    parsed = await readJsonCapped(req, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "image must be under 8 MB" }, { status: 413 });
    parsed = undefined;
  }
  const raw = (parsed && typeof parsed === "object" ? parsed : null) as { id?: unknown; dataUrl?: unknown } | null;
  const body = raw && typeof raw.id === "string" && typeof raw.dataUrl === "string" ? { id: raw.id, dataUrl: raw.dataUrl } : null;
  const slot = body?.id ? mediaSlotById(body.id) : undefined;
  if (!slot || !body?.dataUrl) {
    return NextResponse.json({ error: "unknown slot or missing data" }, { status: 400 });
  }
  const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(body.dataUrl);
  const ext = match ? MIME_EXT[match[1].toLowerCase()] : undefined;
  if (!match || !ext) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 415 });
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "image must be under 8 MB" }, { status: 413 });
  }
  if (sniff(bytes) !== match[1].toLowerCase()) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 415 });
  }

  const manifest = await readManifest();
  // Drop a previous file with a different extension before replacing.
  const prev = manifest[slot.id];
  if (prev && prev.ext !== ext) {
    await fs.rm(path.join(STORE_DIR, `${slot.id}.${prev.ext}`), { force: true });
  }
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(path.join(STORE_DIR, `${slot.id}.${ext}`), bytes);
  manifest[slot.id] = {
    ext,
    type: match[1].toLowerCase(),
    updatedAt: Date.now(),
  };
  await writeManifest(manifest);
  return NextResponse.json({ ok: true, slot: manifest[slot.id] });
}

/** Admin: clear one slot (?id=…) back to its placeholder. */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.res;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const slot = mediaSlotById(id);
  if (!slot) {
    return NextResponse.json({ error: "unknown slot" }, { status: 400 });
  }
  const manifest = await readManifest();
  const entry = manifest[id];
  if (entry) {
    await fs.rm(path.join(STORE_DIR, `${id}.${entry.ext}`), { force: true });
    delete manifest[id];
    await writeManifest(manifest);
  }
  return NextResponse.json({ ok: true });
}

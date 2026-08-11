import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { promises as fs } from "fs";
import path from "path";

import { mediaSlotById } from "@/lib/media-slots";

// Runtime store for admin-uploaded media. Files live on the web server's
// disk (data/media under the app root) so uploads work anywhere `next
// start` runs on a node host; on ephemeral/serverless hosts uploads last
// until the instance recycles — the admin UI says so.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = path.join(process.cwd(), "data", "media");
const MANIFEST = path.join(STORE_DIR, "manifest.json");
const MAX_BYTES = 8 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

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

async function requireUser() {
  try {
    const { userId } = await auth();
    return userId;
  } catch {
    return null;
  }
}

/** Admin: upload/replace one slot. Body: { id, dataUrl }. */
export async function POST(req: NextRequest) {
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as
    | { id?: string; dataUrl?: string }
    | null;
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
  if (!(await requireUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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

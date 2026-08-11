import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

import { mediaSlotById } from "@/lib/media-slots";

// Public byte-server for uploaded slot images (see ../route.ts).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = path.join(process.cwd(), "data", "media");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!mediaSlotById(id)) {
    return new NextResponse("not found", { status: 404 });
  }
  let manifest: Record<string, { ext: string; type: string }>;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(STORE_DIR, "manifest.json"), "utf8"),
    );
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
  const entry = manifest[id];
  if (!entry) return new NextResponse("not found", { status: 404 });
  try {
    const bytes = await fs.readFile(path.join(STORE_DIR, `${id}.${entry.ext}`));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": entry.type,
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}

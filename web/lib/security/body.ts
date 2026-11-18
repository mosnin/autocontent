// Bounded request-body readers. `req.json()` and `req.arrayBuffer()` buffer
// whatever the client sends; these stop at a byte cap.

export class BodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`body is larger than ${limit} bytes`);
  }
}

/** Read at most `limit` bytes. Throws BodyTooLargeError past the cap (checked on Content-Length first, then on the stream). */
export async function readBodyCapped(req: { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLargeError(limit);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(limit);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Bounded JSON body. Returns `undefined` when the body is not JSON. */
export async function readJsonCapped(req: Parameters<typeof readBodyCapped>[0], limit: number): Promise<unknown> {
  const bytes = await readBodyCapped(req, limit);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

// Small in-memory fixed-window limiter. It is per server instance: on a
// multi-instance or serverless deploy each instance keeps its own counters, so
// treat it as a floor against abuse from one session, not a global quota. The
// backend and the model provider keep their own limits.

export interface RateLimiter {
  /** Count one hit for `key`. `ok` is false once the window is full. */
  hit(key: string): { ok: boolean; retryAfterSeconds: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000, now = Date.now } = opts;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        if (!w && windows.size >= maxKeys) {
          // Bounded memory: drop expired windows, then the oldest entries.
          for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
          for (const k of windows.keys()) {
            if (windows.size < maxKeys) break;
            windows.delete(k);
          }
        }
        w = { start: t, count: 0 };
        windows.delete(key);
        windows.set(key, w);
      }
      w.count++;
      if (w.count > limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
      return { ok: true, retryAfterSeconds: 0 };
    },
  };
}

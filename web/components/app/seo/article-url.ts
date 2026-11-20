/**
 * URL filter for the article renderer. Article markdown is written by a
 * model from web research, so every link and image target is untrusted.
 *
 * Allowed: absolute http(s) URLs, and same-site relative ones (`/path`,
 * `#anchor`). Refused: every other scheme (`javascript:`, `data:`, `vbscript:`,
 * `file:`…), protocol-relative `//host`, backslash host tricks, credentials
 * in the URL and control characters. Images may also be an inline raster
 * `data:` URI (PNG, JPEG, WebP or GIF, base64): that is how generated
 * images can be embedded. SVG is never allowed, inline or not as data.
 *
 * Pure, so it is tested in web/test/article-url.test.ts.
 */

export interface SafeUrl {
  href: string;
  /** Leaves this site: open in a new tab with rel="noopener noreferrer". */
  external: boolean;
}

const RASTER_DATA = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeArticleUrl(raw: unknown, kind: "link" | "image" = "link"): SafeUrl | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 4096 || CONTROL.test(value) || value.includes("\\")) {
    // A generated inline image can be long; it has its own strict shape.
    if (kind === "image" && typeof raw === "string" && raw.length <= 2_000_000 && RASTER_DATA.test(raw.trim())) return { href: raw.trim(), external: false };
    return null;
  }
  if (kind === "image" && RASTER_DATA.test(value)) return { href: value, external: false };

  // Same-site relative: one leading slash (never `//host`), or an in-page anchor.
  if (value.startsWith("#")) return { href: value, external: false };
  if (value.startsWith("/")) return value.startsWith("//") ? null : { href: value, external: false };

  // Everything else must be an absolute http(s) URL. Anything with another scheme, or no scheme, is refused.
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const u = new URL(value);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname) return null;
    return { href: u.toString(), external: true };
  } catch {
    return null;
  }
}

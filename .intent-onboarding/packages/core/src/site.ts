import type { WebsiteScan } from './enrichers.ts';

/**
 * Tech fingerprints for pre-selection (RULES §2.2). Each signal is a regex over raw HTML.
 * Conservative on purpose: a false pre-selection costs a tap, a missed one only costs ranking.
 */
export const TECH_SIGNATURES: Record<string, RegExp[]> = {
  meta_pixel: [/connect\.facebook\.net\/[^"']*\/fbevents\.js/i, /\bfbq\(\s*['"]init['"]/i],
  google_ads_tag: [/googletagmanager\.com\/gtag\/js\?id=AW-/i, /gtag\(\s*['"]config['"]\s*,\s*['"]AW-/i, /googleadservices\.com\/pagead\/conversion/i],
  google_analytics: [/googletagmanager\.com\/gtag\/js\?id=G-/i, /google-analytics\.com\/(analytics|ga)\.js/i],
  google_tag_manager: [/googletagmanager\.com\/gtm\.js/i],
  tiktok_pixel: [/analytics\.tiktok\.com\/i18n\/pixel/i, /\bttq\.load\(/i],
  linkedin_insight: [/snap\.licdn\.com\/li\.lms-analytics/i, /_linkedin_partner_id/i],
  pinterest_tag: [/s\.pinimg\.com\/ct\/core\.js/i, /\bpintrk\(/i],
  snap_pixel: [/sc-static\.net\/scevent\.min\.js/i, /\bsnaptr\(/i],
  shopify: [/cdn\.shopify\.com/i, /Shopify\.theme/i],
  woocommerce: [/woocommerce/i],
  wordpress: [/wp-content\//i],
  webflow: [/webflow\.(com|io)/i, /data-wf-site/i],
  squarespace: [/static1\.squarespace\.com/i],
  wix: [/static\.wixstatic\.com/i],
  hubspot: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i],
  intercom: [/widget\.intercom\.io/i, /intercomSettings/i],
  zendesk_widget: [/static\.zdassets\.com/i, /\.zendesk\.com\/embeddable/i],
  helpscout_beacon: [/beacon-v2\.helpscout\.net/i],
  help_center_link: [/href=["'][^"']*(help|support|docs)\.[a-z0-9-]+\.[a-z]+/i, /href=["'][^"']*\/(help|support|faq)["'/]/i],
  calendly_embed: [/assets\.calendly\.com/i, /calendly\.com\/[a-z0-9-]+/i],
  stripe: [/js\.stripe\.com/i],
  klaviyo: [/static\.klaviyo\.com/i],
  instagram_link: [/href=["']https?:\/\/(www\.)?instagram\.com\/(?!p\/|explore\/)[a-z0-9_.]+\/?["']/i],
  facebook_link: [/href=["']https?:\/\/(www\.)?facebook\.com\/(?!sharer)[a-z0-9_.-]+\/?["']/i],
  linkedin_link: [/href=["']https?:\/\/(www\.)?linkedin\.com\/company\/[a-z0-9_-]+/i],
  tiktok_link: [/href=["']https?:\/\/(www\.)?tiktok\.com\/@[a-z0-9_.]+/i],
};

export function detectTech(html: string): string[] {
  return Object.entries(TECH_SIGNATURES)
    .filter(([, patterns]) => patterns.some((p) => p.test(html)))
    .map(([id]) => id);
}

const CURRENCY_BY_TLD: Record<string, string> = {
  uk: 'GBP', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', ie: 'EUR', at: 'EUR', be: 'EUR', fi: 'EUR', pt: 'EUR',
  ca: 'CAD', au: 'AUD', nz: 'NZD', jp: 'JPY', in: 'INR', ch: 'CHF', se: 'SEK', no: 'NOK', dk: 'DKK', br: 'BRL', mx: 'MXN',
};

function meta(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${key}["']`, 'i');
  const m = html.match(re);
  return decode((m?.[1] ?? m?.[2])?.trim());
}

function decode(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Strip " | Home", " – Official Site" and similar suffixes from a <title>. */
function cleanTitle(t: string): string {
  const parts = t.split(/\s[|–—·:-]\s/).map((p) => p.trim()).filter(Boolean);
  const generic = /^(home|homepage|official (site|website|store)|welcome|shop|store)$/i;
  return parts.find((p) => !generic.test(p)) ?? parts[0] ?? t.trim();
}

/** Extract what onboarding can use from a homepage's HTML. Pure and deterministic, so it's testable. */
export function extractSite(html: string, url: string): WebsiteScan {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const businessName = meta(html, 'og:site_name') ?? meta(html, 'application-name') ?? (title ? cleanTitle(decode(title)!) : undefined);
  const description = meta(html, 'og:description') ?? meta(html, 'description');
  const tld = host.split('.').pop()?.toLowerCase() ?? '';
  const currency =
    meta(html, 'og:price:currency') ??
    meta(html, 'product:price:currency') ??
    html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1] ??
    html.match(/"priceCurrency"\s*:\s*"([A-Z]{3})"/)?.[1] ??
    CURRENCY_BY_TLD[tld];
  const logoUrl = meta(html, 'og:image');
  const brandColor = meta(html, 'theme-color');
  return { businessName, description, currency, logoUrl, brandColor, detects: detectTech(html) };
}

/**
 * Fetch a homepage and extract it. Server-side only (CORS); hosts call this from an API route.
 * Bounded by a timeout so a slow site never blocks onboarding; failure returns undefined.
 */
export async function scanWebsite(url: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<WebsiteScan | undefined> {
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await f(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; IntentOnboarding/0.1; +https://github.com/mosnin/onboarding-starter)', accept: 'text/html' } });
    if (!res.ok) return undefined;
    const html = (await res.text()).slice(0, 750_000);
    return extractSite(html, res.url || url);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

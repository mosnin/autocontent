import type { Enricher, Inference } from './types.ts';

/** Consumer mailbox providers: the domain says nothing about the business (low confidence). */
export const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
  'yandex.com', 'zoho.com', 'fastmail.com', 'hey.com', 'pm.me', 'mail.com',
]);

export function emailDomain(email: string): string | undefined {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1).toLowerCase().trim() : undefined;
}

export function isPersonalDomain(domain: string | undefined): boolean {
  return !domain || PERSONAL_EMAIL_DOMAINS.has(domain);
}

/** "acme-studio.co.uk" → "Acme Studio". A guess; always confirmed, never acted on silently. */
export function companyFromDomain(domain: string): string {
  const label = domain.split('.').find((p) => p !== 'www') ?? domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Field-name mapping for the built-in enrichers. Specs use their own field ids;
 * pass a map so built-ins write to the right ones.
 */
export interface FieldMap {
  displayName?: string;
  avatar?: string;
  businessName?: string;
  website?: string;
  timezone?: string;
  referralSource?: string;
}

/** Name, avatar and provider from the sign-in identity. */
export function oauthProfileEnricher(map: FieldMap = { displayName: 'displayName', avatar: 'avatar' }): Enricher {
  return async ({ profile }) => {
    const inferences: Inference[] = [];
    if (map.displayName && profile.name) inferences.push({ field: map.displayName, value: profile.name, source: 'oauth_profile', confidence: 0.95 });
    if (map.avatar && profile.avatarUrl) inferences.push({ field: map.avatar, value: profile.avatarUrl, source: 'oauth_profile', confidence: 0.95 });
    return { inferences, signals: { oauthProviders: profile.provider ? [profile.provider] : [] } };
  };
}

/** Business name + website from a business email domain. */
export function emailDomainEnricher(map: FieldMap = { businessName: 'businessName', website: 'website' }): Enricher {
  return async ({ profile }) => {
    const domain = emailDomain(profile.email);
    const inferences: Inference[] = [];
    if (domain && !isPersonalDomain(domain)) {
      if (map.website) inferences.push({ field: map.website, value: `https://${domain}`, source: 'email_domain', confidence: 0.9 });
      if (map.businessName) inferences.push({ field: map.businessName, value: companyFromDomain(domain), source: 'email_domain', confidence: 0.7 });
    }
    return { inferences, signals: { emailDomain: domain } };
  };
}

/** Timezone from the browser; attribution from UTM (deferrable, never asked). */
export function browserEnricher(map: FieldMap = { timezone: 'timezone', referralSource: 'referralSource' }): Enricher {
  return async ({ profile }) => {
    const inferences: Inference[] = [];
    if (map.timezone && profile.timezone) inferences.push({ field: map.timezone, value: profile.timezone, source: 'browser', confidence: 0.9 });
    const utm = profile.utm?.utm_source;
    if (map.referralSource && utm) inferences.push({ field: map.referralSource, value: utm, source: 'utm', confidence: 0.8 });
    return { inferences };
  };
}

/**
 * Website scan contract. The host supplies `scan` (fetch + extraction, typically an LLM call
 * plus a tech-detection pass). This wrapper maps the result into inferences and signals.
 */
export interface WebsiteScan {
  businessName?: string;
  description?: string;
  currency?: string;
  country?: string;
  logoUrl?: string;
  brandColor?: string;
  /** e.g. ['meta_pixel', 'google_ads_tag', 'shopify', 'instagram_link'] */
  detects?: string[];
  /** Arbitrary field-id → value pairs the scan can fill (hero product, competitors…). */
  fields?: Record<string, unknown>;
}

export function websiteEnricher(
  scan: (url: string) => Promise<WebsiteScan | undefined>,
  opts: { websiteField?: string; businessNameField?: string; currencyField?: string; confidence?: number } = {},
): Enricher {
  const websiteField = opts.websiteField ?? 'website';
  const confidence = opts.confidence ?? 0.85;
  return async ({ context, profile }) => {
    // Prefer an explicit/inferred website; otherwise derive it from a business email domain.
    const domain = emailDomain(profile.email);
    const fromContext = context[websiteField]?.value;
    const url = typeof fromContext === 'string' ? fromContext : domain && !isPersonalDomain(domain) ? `https://${domain}` : undefined;
    if (!url) return { inferences: [] };
    const r = await scan(url);
    if (!r) return { inferences: [] };
    const inferences: Inference[] = [];
    if (r.businessName) inferences.push({ field: opts.businessNameField ?? 'businessName', value: r.businessName, source: 'website', confidence });
    if (r.currency) inferences.push({ field: opts.currencyField ?? 'currency', value: r.currency, source: 'website', confidence });
    for (const [field, value] of Object.entries(r.fields ?? {})) inferences.push({ field, value, source: 'website', confidence: confidence - 0.1 });
    const siteSummary = [r.businessName, r.description].filter(Boolean).join(': ') || undefined;
    return { inferences, signals: { websiteDetects: r.detects ?? [], siteSummary } };
  };
}

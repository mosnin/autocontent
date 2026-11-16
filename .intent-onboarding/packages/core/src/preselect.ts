import type { IntentOption, IntentQuestion, PreselectSignal } from '../../spec/src/index.ts';
import type { Signals } from './types.ts';

export const EMPTY_SIGNALS: Signals = {
  websiteDetects: [],
  oauthProviders: [],
  icpOptionShare: {},
  connectorFacts: {},
};

export function mergeSignals(a: Signals, b: Partial<Signals> | undefined): Signals {
  if (!b) return a;
  return {
    websiteDetects: unique([...a.websiteDetects, ...(b.websiteDetects ?? [])]),
    emailDomain: b.emailDomain ?? a.emailDomain,
    oauthProviders: unique([...a.oauthProviders, ...(b.oauthProviders ?? [])]),
    icpOptionShare: { ...a.icpOptionShare, ...(b.icpOptionShare ?? {}) },
    connectorFacts: { ...a.connectorFacts, ...(b.connectorFacts ?? {}) },
    siteSummary: b.siteSummary ?? a.siteSummary,
  };
}

function matchesSignal(sig: PreselectSignal, option: IntentOption, s: Signals): boolean {
  switch (sig.source) {
    case 'website':
      return s.websiteDetects.includes(sig.detects);
    case 'email_domain': {
      if (!s.emailDomain) return false;
      try {
        return new RegExp(`^(?:${sig.matches})$`, 'i').test(s.emailDomain);
      } catch {
        return s.emailDomain.toLowerCase() === sig.matches.toLowerCase();
      }
    }
    case 'oauth_profile':
      return s.oauthProviders.includes(sig.has);
    case 'icp':
      return (s.icpOptionShare[option.id] ?? 0) >= sig.segmentShareAtLeast;
    default: {
      // `connector:<id>`
      const facts = s.connectorFacts[sig.source] ?? [];
      return 'has' in sig ? facts.includes(sig.has) : false;
    }
  }
}

/** The "I don't do this today" option: exclusive, listed last, never pre-selected. */
export function isNoneOption(o: IntentOption): boolean {
  return Boolean(o.none) || o.capabilities.length === 0;
}

/** Options to pre-select for a question, given what we know (RULES §2.2). */
export function preselect(question: IntentQuestion, signals: Signals): string[] {
  const hits = question.options.filter((o) => !isNoneOption(o) && o.preselectWhen?.some((sig) => matchesSignal(sig, o, signals)));
  if (question.kind === 'single') return hits.slice(0, 1).map((o) => o.id);
  return hits.map((o) => o.id);
}

/**
 * Order options so the most likely answers come first: pre-selected, then by ICP share,
 * then as authored. "None / not yet" options (no capabilities) always stay last.
 */
export function rankOptions(question: IntentQuestion, signals: Signals): IntentOption[] {
  const pre = new Set(preselect(question, signals));
  const authored = new Map(question.options.map((o, i) => [o.id, i]));
  return [...question.options].sort((a, b) => {
    const noneA = isNoneOption(a) ? 1 : 0;
    const noneB = isNoneOption(b) ? 1 : 0;
    if (noneA !== noneB) return noneA - noneB;
    const preA = pre.has(a.id) ? 0 : 1;
    const preB = pre.has(b.id) ? 0 : 1;
    if (preA !== preB) return preA - preB;
    const share = (signals.icpOptionShare[b.id] ?? 0) - (signals.icpOptionShare[a.id] ?? 0);
    if (share !== 0) return share;
    return (authored.get(a.id) ?? 0) - (authored.get(b.id) ?? 0);
  });
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

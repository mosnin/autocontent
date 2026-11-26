import type { CapabilityDef, OnboardingSpec, ScreenKind, ScreenPurpose } from './types.ts';

/** Default time estimates (seconds) for derived screens. Templates may override per connector. */
export const SCREEN_SECONDS: Record<ScreenKind, number> = {
  signin: 8,
  confirm: 6,
  intent: 7,
  connect: 20,
  rehearsal: 18,
  consent: 8,
  invite: 15,
  handoff: 0,
};

export interface DerivedScreen {
  id: string;
  kind: ScreenKind;
  purpose: ScreenPurpose;
  estSeconds: number;
  capability?: string;
  connector?: string;
  optional?: boolean;
  /** Fields resolved on this screen (inferred-and-confirmed or asked in context). */
  fields: string[];
}

export interface DerivedPath {
  screens: DerivedScreen[];
  /** Screens before the dashboard (handoff excluded). */
  screenCount: number;
  totalSeconds: number;
  /** Signup → first proof from the user's own data. Infinity if no capability was selected. */
  secondsToProof: number;
  primary?: string;
  secondary?: string;
  deferred: string[];
  shownConnectors: string[];
  selectedCapabilities: string[];
  /** Required fields with no inference source and no in-context ask. */
  unresolvedFields: string[];
}

/**
 * Deterministically derive the screens a user sees for a given set of chosen intent options.
 * This is the reference planner policy (RULES §6.2): resolve context, then ask intent, connect
 * the primary capability, rehearse, offer at most one optional secondary step, then hand off.
 * The runtime planner may reorder copy, but never adds screens beyond what this produces.
 */
export function derivePath(spec: OnboardingSpec, chosenOptionIds: string[]): DerivedPath {
  const chosen = new Set(chosenOptionIds);
  const screens: DerivedScreen[] = [];
  const selected = new Set<string>();
  const capById = new Map(spec.capabilities.map((c) => [c.id, c]));
  const fieldById = new Map(spec.fields.map((f) => [f.id, f]));

  screens.push({ id: 'signin', kind: 'signin', purpose: 'gather', estSeconds: SCREEN_SECONDS.signin, fields: [] });

  // Intent questions, in order, respecting askWhen.
  const intentScreens: DerivedScreen[] = [];
  for (const q of spec.intents) {
    if (q.askWhen && !q.askWhen.some((c) => selected.has(c))) continue;
    intentScreens.push({ id: `intent:${q.id}`, kind: 'intent', purpose: 'gather', estSeconds: SCREEN_SECONDS.intent, fields: [] });
    for (const o of q.options) if (chosen.has(o.id)) o.capabilities.forEach((c) => selected.add(c));
  }

  const ranked = [...selected]
    .map((id) => capById.get(id))
    .filter((c): c is CapabilityDef => Boolean(c))
    .sort((a, b) => a.priority - b.priority);
  const primary = ranked[0];
  const secondary = spec.budget.maxSecondary >= 1 ? ranked[1] : undefined;
  const deferred = ranked.slice(secondary ? 2 : 1).map((c) => c.id);
  const active = [primary, secondary].filter((c): c is CapabilityDef => Boolean(c));

  // Fields required right now: blocking/workflow fields of active capabilities,
  // plus deferrable fields promoted by blockingWhen.
  const required = new Set<string>();
  for (const cap of active) for (const f of cap.fields) required.add(f);
  for (const f of spec.fields) {
    if (f.tier !== 'deferrable' && !active.some((c) => c.fields.includes(f.id))) {
      // Global blocking fields (not tied to a capability) are always required.
      if (f.tier === 'blocking' && !spec.capabilities.some((c) => c.fields.includes(f.id))) required.add(f.id);
    }
    if (f.blockingWhen?.some((c) => active.some((a) => a.id === c))) required.add(f.id);
  }

  // Confirm screen: shown whenever the spec has non-deferrable fields inferable before any
  // connector, independent of the answers, so screens before the intent never shift.
  // Its fields are those the active capabilities need (or all candidates before any answer).
  const isPreConnector = (id: string) => {
    const f = fieldById.get(id);
    return Boolean(f && f.tier !== 'deferrable' && f.infer.some((s) => !s.startsWith('connector:')));
  };
  const candidates = spec.fields.filter((f) => isPreConnector(f.id)).map((f) => f.id);
  const preConnector = [...required].filter(isPreConnector);
  if (candidates.length > 0) {
    screens.push({ id: 'confirm', kind: 'confirm', purpose: 'gather', estSeconds: SCREEN_SECONDS.confirm, fields: active.length ? preConnector : candidates });
  }
  screens.push(...intentScreens);

  let elapsed = screens.reduce((s, x) => s + x.estSeconds, 0);
  let secondsToProof = Number.POSITIVE_INFINITY;
  const shownConnectors: string[] = [];

  const pushConnect = (cap: CapabilityDef, optional: boolean) => {
    for (const cid of cap.connectors) {
      if (shownConnectors.includes(cid)) continue;
      const conn = spec.connectors.find((c) => c.id === cid);
      const est = conn?.estSeconds ?? SCREEN_SECONDS.connect;
      screens.push({ id: `connect:${cid}`, kind: 'connect', purpose: 'setup', estSeconds: est, capability: cap.id, connector: cid, optional, fields: [] });
      shownConnectors.push(cid);
      elapsed += est;
    }
    // Activation starts at verify (end of connect screen) and runs in parallel.
    const proofAt = elapsed + cap.activation.estSecondsToFirstResult;
    secondsToProof = Math.min(secondsToProof, proofAt);
  };

  if (primary) {
    pushConnect(primary, false);
    const rehearsalFields = [...required].filter((id) => fieldById.get(id)?.askInContext?.on === 'rehearsal');
    screens.push({ id: `rehearsal:${primary.id}`, kind: 'rehearsal', purpose: 'prove', estSeconds: SCREEN_SECONDS.rehearsal, capability: primary.id, fields: rehearsalFields });
    elapsed += SCREEN_SECONDS.rehearsal;
  }
  if (secondary) pushConnect(secondary, true);

  // Screens needed only because a required field must be asked on a kind not yet present.
  const kindsPresent = new Set(screens.map((s) => s.kind));
  const unresolvedFields: string[] = [];
  for (const id of required) {
    const f = fieldById.get(id);
    if (!f) continue;
    if (f.askInContext) {
      if (!kindsPresent.has(f.askInContext.on)) {
        const kind = f.askInContext.on;
        screens.push({ id: kind, kind, purpose: kind === 'invite' ? 'setup' : 'gather', estSeconds: SCREEN_SECONDS[kind], fields: [id] });
        kindsPresent.add(kind);
        elapsed += SCREEN_SECONDS[kind];
      } else if (f.askInContext.on !== 'rehearsal') {
        screens.find((s) => s.kind === f.askInContext!.on)?.fields.push(id);
      }
    } else if (f.infer.length === 0) {
      unresolvedFields.push(id);
    }
  }

  for (const cs of spec.customScreens ?? []) {
    if (cs.when && !cs.when.some((c) => active.some((a) => a.id === c))) continue;
    screens.push({ id: `custom:${cs.id}`, kind: cs.kind, purpose: cs.purpose, estSeconds: cs.estSeconds, fields: cs.fills ?? [] });
    elapsed += cs.estSeconds;
  }

  screens.push({ id: 'handoff', kind: 'handoff', purpose: 'prove', estSeconds: 0, fields: [] });

  return {
    screens,
    screenCount: screens.filter((s) => s.kind !== 'handoff').length,
    totalSeconds: elapsed,
    secondsToProof,
    primary: primary?.id,
    secondary: secondary?.id,
    deferred,
    shownConnectors,
    selectedCapabilities: [...selected],
    unresolvedFields,
  };
}

/** Representative selections the linter checks: each option alone, plus everything chosen. */
export function representativeSelections(spec: OnboardingSpec): { label: string; options: string[] }[] {
  const out: { label: string; options: string[] }[] = [];
  const all = spec.intents.flatMap((q) => q.options.map((o) => o.id));
  for (const q of spec.intents) {
    for (const o of q.options) {
      // Pair each option with the first capability-bearing option of every other question.
      const others = spec.intents
        .filter((x) => x !== q)
        .map((x) => x.options.find((y) => y.capabilities.length > 0)?.id)
        .filter((x): x is string => Boolean(x));
      out.push({ label: `${q.id}=${o.id}`, options: [o.id, ...others] });
    }
  }
  out.push({ label: 'everything selected', options: all });
  return out;
}

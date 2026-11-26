/**
 * Vendor-neutral metric computation over raw onboarding events (the standard schema).
 * The same functions back the insights CLI, tests, and any dashboard, so numbers always agree.
 */

export interface RawEvent {
  event: string;
  distinctId: string;
  /** Epoch ms. */
  timestamp: number;
  properties: Record<string, unknown>;
}

export interface ScreenStat {
  screenId: string;
  kind: string;
  viewed: number;
  completed: number;
  skipped: number;
  /** 1 - users who got past this screen / users who saw it (excludes users still in progress at the end). */
  dropOff: number;
  medianSeconds: number;
  p75Seconds: number;
}

export interface OnboardingMetrics {
  users: number;
  completed: number;
  ahaUsers: number;
  ahaRate: number;
  completionRate: number;
  timeToFirstProof: { median: number; p75: number; n: number };
  timeToAha: { median: number; p75: number; n: number };
  /** Seconds from activation_started to the first proof_rendered for that capability. */
  activationLatency: Record<string, { median: number; n: number }>;
  proofAcceptance: Record<string, { shown: number; acted: number; rate: number }>;
  /** Per user: unique connectors verified / unique connectors attempted. */
  intentMatch: { started: number; verified: number; rate: number };
  connectorFailures: Record<string, { started: number; failed: number; rate: number }>;
  inference: Record<string, { shown: number; corrected: number; correctionRate: number }>;
  preselection: { preselected: number; kept: number; accuracy: number };
  /** Aha rate for users who chose each intent option. */
  intentOptions: Record<string, { users: number; aha: number; ahaRate: number }>;
  reconfiguration: { rate: number; bySetting: Record<string, number> };
  screens: ScreenStat[];
  byVariant: Record<string, { users: number; ahaRate: number; timeToFirstProofMedian: number }>;
}

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};
const median = (xs: number[]) => quantile(xs, 0.5);
const rate = (a: number, b: number) => (b === 0 ? 0 : a / b);
const sec = (ms: unknown) => Number(ms) / 1000;

export function computeMetrics(events: RawEvent[]): OnboardingMetrics {
  const byUser = new Map<string, RawEvent[]>();
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const list = byUser.get(e.distinctId) ?? [];
    list.push(e);
    byUser.set(e.distinctId, list);
  }

  const started = [...byUser.entries()].filter(([, evs]) => evs.some((e) => e.event === 'onboarding_started'));
  const users = started.length;
  const ttfp: number[] = [];
  const tta: number[] = [];
  let completed = 0;
  let ahaUsers = 0;
  const proofAcceptance: OnboardingMetrics['proofAcceptance'] = {};
  const activation: Record<string, number[]> = {};
  const connectors: OnboardingMetrics['connectorFailures'] = {};
  let connStarted = 0;
  let connVerified = 0;
  const inference: OnboardingMetrics['inference'] = {};
  let pre = 0;
  let kept = 0;
  const intentOptions: OnboardingMetrics['intentOptions'] = {};
  const reconfigUsers = new Set<string>();
  const bySetting: Record<string, Set<string>> = {};
  const screenAgg = new Map<string, { kind: string; viewed: Set<string>; completed: Set<string>; skipped: number; durations: number[] }>();
  const variants: Record<string, { users: Set<string>; aha: Set<string>; ttfp: number[] }> = {};

  for (const [uid, evs] of started) {
    const has = (n: string) => evs.some((e) => e.event === n);
    const isComplete = has('onboarding_completed');
    const isAha = has('aha_reached');
    if (isComplete) completed++;
    if (isAha) ahaUsers++;

    const variant = String(evs.find((e) => e.event === 'onboarding_started')?.properties.variant ?? 'intent');
    const v = (variants[variant] ??= { users: new Set(), aha: new Set(), ttfp: [] });
    v.users.add(uid);
    if (isAha) v.aha.add(uid);

    const ownProof = evs.find((e) => e.event === 'proof_rendered' && e.properties.source === 'own') ?? evs.find((e) => e.event === 'proof_rendered');
    if (ownProof) {
      ttfp.push(sec(ownProof.properties.ms_since_start));
      v.ttfp.push(sec(ownProof.properties.ms_since_start));
    }
    const aha = evs.find((e) => e.event === 'aha_reached');
    if (aha) tta.push(sec(aha.properties.ms_since_start));

    // Proof acceptance per proof id (per user, not per event).
    const shownProofs = new Set(evs.filter((e) => e.event === 'proof_rendered').map((e) => String(e.properties.proof_id)));
    const actedProofs = new Set(evs.filter((e) => e.event === 'aha_reached').map((e) => String(e.properties.proof_id)));
    for (const p of shownProofs) {
      const a = (proofAcceptance[p] ??= { shown: 0, acted: 0, rate: 0 });
      a.shown++;
      if (actedProofs.has(p)) a.acted++;
    }

    // Activation latency.
    for (const s of evs.filter((e) => e.event === 'activation_started')) {
      const cap = String(s.properties.capability);
      const p = evs.find((e) => e.event === 'proof_rendered' && e.properties.capability === cap);
      if (p) (activation[cap] ??= []).push(sec(Number(p.properties.ms_since_start) - Number(s.properties.ms_since_start)));
    }

    // Intent match per user: unique connectors verified / unique connectors attempted (retries count once).
    const attempted = new Set(evs.filter((e) => e.event === 'connector_started').map((e) => String(e.properties.connector)));
    const verifiedSet = new Set(evs.filter((e) => e.event === 'connector_verified').map((e) => String(e.properties.connector)));
    connStarted += attempted.size;
    connVerified += [...verifiedSet].filter((c) => attempted.has(c)).length;

    // Connector attempts and failures (every attempt counts here).
    for (const e of evs) {
      if (!e.event.startsWith('connector_')) continue;
      const c = String(e.properties.connector);
      const agg = (connectors[c] ??= { started: 0, failed: 0, rate: 0 });
      if (e.event === 'connector_started') agg.started++;
      if (e.event === 'connector_failed') agg.failed++;
    }

    // Inference: fields shown on confirm vs corrected.
    for (const e of evs.filter((x) => x.event === 'confirm_shown')) {
      for (const f of (e.properties.fields as string[] | undefined) ?? []) (inference[f] ??= { shown: 0, corrected: 0, correctionRate: 0 }).shown++;
    }
    for (const e of evs.filter((x) => x.event === 'confirm_corrected')) (inference[String(e.properties.field)] ??= { shown: 0, corrected: 0, correctionRate: 0 }).corrected++;

    // Pre-selection + intent options.
    for (const e of evs.filter((x) => x.event === 'intent_answered')) {
      const p = (e.properties.preselected as string[] | undefined) ?? [];
      const k = (e.properties.preselected_kept as string[] | undefined) ?? [];
      pre += p.length;
      kept += k.length;
      for (const o of (e.properties.options as string[] | undefined) ?? []) {
        const io = (intentOptions[o] ??= { users: 0, aha: 0, ahaRate: 0 });
        io.users++;
        if (isAha) io.aha++;
      }
    }

    // Reconfiguration.
    for (const e of evs.filter((x) => x.event === 'setting_changed' && x.properties.set_by_onboarding && x.properties.first_session)) {
      reconfigUsers.add(uid);
      (bySetting[String(e.properties.setting)] ??= new Set()).add(uid);
    }

    // Screens.
    for (const e of evs) {
      if (e.event !== 'screen_viewed' && e.event !== 'screen_completed') continue;
      const id = String(e.properties.screen_id);
      const agg = screenAgg.get(id) ?? { kind: String(e.properties.kind ?? ''), viewed: new Set(), completed: new Set(), skipped: 0, durations: [] };
      if (e.event === 'screen_viewed') agg.viewed.add(uid);
      else {
        agg.completed.add(uid);
        if (e.properties.skipped) agg.skipped++;
        agg.durations.push(sec(e.properties.duration_ms));
      }
      screenAgg.set(id, agg);
    }
  }

  for (const a of Object.values(proofAcceptance)) a.rate = rate(a.acted, a.shown);
  for (const c of Object.values(connectors)) c.rate = rate(c.failed, c.started);
  for (const f of Object.values(inference)) f.correctionRate = rate(f.corrected, f.shown);
  for (const o of Object.values(intentOptions)) o.ahaRate = rate(o.aha, o.users);

  const screens: ScreenStat[] = [...screenAgg.entries()]
    .filter(([id, a]) => id !== 'signin' && a.kind !== 'handoff') // handoff is terminal, never 'completed'
    .map(([screenId, a]) => ({
      screenId,
      kind: a.kind,
      viewed: a.viewed.size,
      completed: a.completed.size,
      skipped: a.skipped,
      dropOff: 1 - rate(a.completed.size, a.viewed.size),
      medianSeconds: median(a.durations),
      p75Seconds: quantile(a.durations, 0.75),
    }))
    .sort((a, b) => b.viewed - a.viewed);

  return {
    users,
    completed,
    ahaUsers,
    ahaRate: rate(ahaUsers, users),
    completionRate: rate(completed, users),
    timeToFirstProof: { median: median(ttfp), p75: quantile(ttfp, 0.75), n: ttfp.length },
    timeToAha: { median: median(tta), p75: quantile(tta, 0.75), n: tta.length },
    activationLatency: Object.fromEntries(Object.entries(activation).map(([k, xs]) => [k, { median: median(xs), n: xs.length }])),
    proofAcceptance,
    intentMatch: { started: connStarted, verified: connVerified, rate: rate(connVerified, connStarted) },
    connectorFailures: connectors,
    inference,
    preselection: { preselected: pre, kept, accuracy: rate(kept, pre) },
    intentOptions,
    reconfiguration: { rate: rate(reconfigUsers.size, completed), bySetting: Object.fromEntries(Object.entries(bySetting).map(([k, s]) => [k, rate(s.size, completed)])) },
    screens,
    byVariant: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { users: v.users.size, ahaRate: rate(v.aha.size, v.users.size), timeToFirstProofMedian: median(v.ttfp) }])),
  };
}

import { ONBOARDING_EVENTS, type OnboardingSpec } from '../../spec/src/index.ts';
import type { ReplayTrace } from './replay.ts';

export interface DoctrineViolation {
  rule: string;
  message: string;
}

/** Events every completed onboarding must have emitted (RULES §9.1). */
const REQUIRED_EVENTS = ['onboarding_started', 'screen_viewed', 'screen_completed', 'intent_answered', 'onboarding_completed', 'dashboard_first_load'] as const;

/**
 * Check a replay trace against the doctrine. Static rules are the linter's job; these are the
 * runtime guarantees: what a real user would actually have experienced.
 */
export function checkDoctrine(spec: OnboardingSpec, trace: ReplayTrace): DoctrineViolation[] {
  const v: DoctrineViolation[] = [];
  const add = (rule: string, message: string) => v.push({ rule, message });
  const b = spec.budget;

  if (!trace.completed) {
    add('R1.1', `Did not reach the dashboard: stuck on "${trace.stuckAt?.screen}" (${trace.stuckAt?.reason}).`);
    return v;
  }

  // R2.3: only intent-implied connectors.
  const implied = new Set(spec.capabilities.filter((c) => trace.intendedCapabilities.includes(c.id)).flatMap((c) => c.connectors));
  for (const c of trace.shownConnectors) if (!implied.has(c)) add('R2.3', `Showed connector "${c}" that the user's answers didn't imply.`);

  // R2.4: at most one optional secondary connect.
  const optionalConnects = trace.screens.filter((s) => s.kind === 'connect' && s.optional).length;
  if (optionalConnects > b.maxSecondary) add('R2.4', `${optionalConnects} optional connect screens (max ${b.maxSecondary}).`);

  // R3.2: no deferrable field on any screen unless promoted.
  const activeCaps = new Set([trace.state.path.primary, trace.state.path.secondary].filter(Boolean));
  for (const s of trace.screens) {
    for (const fid of s.fields) {
      const f = spec.fields.find((x) => x.id === fid);
      if (f?.tier === 'deferrable' && !f.blockingWhen?.some((c) => activeCaps.has(c))) add('R3.2', `Deferrable field "${fid}" appeared on "${s.id}".`);
      if (f?.category === 'marketing') add('R3.6', `Marketing field "${fid}" appeared on "${s.id}".`);
    }
  }

  // R3.x: blocking fields of active capabilities resolved by the dashboard.
  for (const capId of activeCaps) {
    const cap = spec.capabilities.find((c) => c.id === capId);
    for (const fid of cap?.fields ?? []) {
      const f = spec.fields.find((x) => x.id === fid);
      if (f?.tier === 'blocking' && trace.state.context[fid]?.value === undefined) add('R3.3', `Blocking field "${fid}" unresolved at the dashboard.`);
    }
  }

  // R4.2: activation starts within 2s of verify.
  for (const ev of trace.events.filter((e) => e.event === 'connector_verified')) {
    const start = trace.events.find((e) => e.event === 'activation_started' && e.properties.capability === ev.properties.capability && e.t >= ev.t);
    if (!start) add('R4.2', `No activation started after "${ev.properties.connector}" verified.`);
    else if (start.t - ev.t > 2000) add('R4.2', `Activation for "${ev.properties.capability}" started ${(start.t - ev.t) / 1000}s after verify (max 2s).`);
  }

  // R4.4: outbound blocked until the rehearsal decision.
  for (const [cap, blocked] of Object.entries(trace.outboundBlockedBeforeRehearsal)) {
    if (!blocked) add('R4.4', `Outbound for "${cap}" was allowed before the rehearsal decision.`);
  }

  // R5.1 / R5.4: proof before the dashboard; the dashboard opens on proof.
  if (!Number.isFinite(trace.secondsToProof)) add('R5.1', 'No proof was shown before the dashboard.');
  if (trace.dashboard[0]?.kind !== 'proof') add('R5.4', `Dashboard does not open on proof (first item: ${trace.dashboard[0]?.kind ?? 'empty'}).`);
  const ownProof = trace.state.proofs.find((p) => p.source === 'own');
  const usedConnector = trace.shownConnectors.some((c) => trace.state.connectors[c] === 'verified');
  if (usedConnector && !ownProof) add('R5.1', 'A connector was verified but no proof came from the user\'s own data.');

  // R6.1: budget.
  const screenCount = trace.screens.length + 1; // + signin
  if (screenCount > b.maxScreens) add('R6.1', `${screenCount} screens before the dashboard (max ${b.maxScreens}).`);
  if (trace.totalSeconds > b.maxSeconds) add('R6.1', `${trace.totalSeconds.toFixed(0)}s to the dashboard (max ${b.maxSeconds}s).`);
  if (trace.secondsToProof > b.maxSecondsToProof) add('R6.1', `${trace.secondsToProof.toFixed(0)}s to first proof (max ${b.maxSecondsToProof}s).`);

  // R9.1: standard events.
  const names = new Set(trace.events.map((e) => e.event));
  for (const e of REQUIRED_EVENTS) if (!names.has(e)) add('R9.1', `Missing standard event "${e}".`);
  for (const e of trace.events) {
    const schema = (ONBOARDING_EVENTS as Record<string, readonly string[]>)[e.event];
    if (!schema) continue;
    for (const key of schema) if (!(key in e.properties)) add('R9.1', `Event "${e.event}" is missing property "${key}".`);
  }

  return dedupe(v);
}

function dedupe(v: DoctrineViolation[]): DoctrineViolation[] {
  const seen = new Set<string>();
  return v.filter((x) => (seen.has(x.rule + x.message) ? false : (seen.add(x.rule + x.message), true)));
}

/** One-line human summary of a trace, for CLI output and test failure messages. */
export function summarize(trace: ReplayTrace): string {
  const proof = Number.isFinite(trace.secondsToProof) ? `${trace.secondsToProof.toFixed(0)}s` : 'none';
  const path = ['signin', ...trace.screens.map((s) => s.id)].join(' → ');
  return `${trace.persona}: ${path} → dashboard  [${trace.screens.length + 1} screens, ${trace.totalSeconds.toFixed(0)}s, proof ${proof}]`;
}

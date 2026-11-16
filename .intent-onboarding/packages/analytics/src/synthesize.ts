import { replay, type PersonaSuite, type TimedEvent } from '../../testing/src/index.ts';
import type { RawEvent } from './metrics.ts';

/** Problems to inject, as probabilities (0–1) or extra seconds. Keys match ids in the spec. */
export interface SyntheticProblems {
  /** Field id → probability the user corrects it on the confirm card. */
  corrections?: Record<string, number>;
  /** Screen id → probability the user abandons on it. */
  dropOff?: Record<string, number>;
  /** Screen id → extra seconds users spend on it. */
  slow?: Record<string, number>;
  /** Proof id → probability a user who sees it acts on it (default 0.75). */
  proofAcceptance?: Record<string, number>;
  /** Setting id → probability it's changed in the first session. */
  reconfigure?: Record<string, number>;
  /** Connector id → probability the first attempt fails (then succeeds on retry). */
  connectorFailures?: Record<string, number>;
  /** Activation capability id → extra seconds before first proof. */
  slowActivation?: Record<string, number>;
}

export interface SynthesizeOptions {
  users: number;
  seed?: number;
  problems?: SyntheticProblems;
  fieldMap?: Record<string, string>;
  variant?: string;
  startAt?: number;
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a realistic event dataset by replaying a persona suite through the real engine, then
 * adding variance and the problems you specify. Used to test the insights engine and to preview
 * INSIGHTS.md before a product has traffic. Deterministic for a given seed.
 */
export async function synthesizeEvents(suite: PersonaSuite, opts: SynthesizeOptions): Promise<RawEvent[]> {
  const rand = prng(opts.seed ?? 42);
  const p = opts.problems ?? {};
  const traces = new Map<string, TimedEvent[]>();
  for (const persona of suite.personas) {
    const trace = await replay(suite.spec, persona, { activations: suite.activations, fieldMap: opts.fieldMap });
    traces.set(persona.name, trace.events);
  }
  const out: RawEvent[] = [];
  const start = opts.startAt ?? Date.UTC(2026, 10, 1);

  for (let i = 0; i < opts.users; i++) {
    const persona = suite.personas[i % suite.personas.length]!;
    const base = traces.get(persona.name)!;
    const uid = `synthetic-${i}`;
    const t0 = start + i * 97_000;
    const pace = 0.85 + rand() * 0.6; // users differ in speed
    let shift = 0; // accumulated extra ms from injected slowness
    const evs: RawEvent[] = [];
    let abandoned = false;

    for (const e of base) {
      if (abandoned) break;
      const props: Record<string, unknown> = { ...e.properties, variant: opts.variant ?? e.properties.variant };
      let t = e.t * pace + shift;
      if (typeof props.ms_since_start === 'number') props.ms_since_start = Math.round((props.ms_since_start as number) * pace + shift);
      if (typeof props.duration_ms === 'number') props.duration_ms = Math.round((props.duration_ms as number) * pace);

      if (e.event === 'screen_completed') {
        const extra = (p.slow?.[String(props.screen_id)] ?? 0) * 1000 * (0.6 + rand() * 0.8);
        props.duration_ms = Number(props.duration_ms) + Math.round(extra);
        shift += extra;
        t += extra;
      }
      if (e.event === 'proof_rendered') {
        const extra = (p.slowActivation?.[String(props.capability)] ?? 0) * 1000;
        shift += extra;
        t += extra;
        props.ms_since_start = Number(props.ms_since_start) + extra;
      }
      if (e.event === 'connector_verified' && rand() < (p.connectorFailures?.[String(props.connector)] ?? 0)) {
        evs.push({ event: 'connector_failed', distinctId: uid, timestamp: t0 + t - 1, properties: { connector: props.connector, capability: props.capability, reason: 'synthetic failure', variant: props.variant } });
        evs.push({ event: 'connector_started', distinctId: uid, timestamp: t0 + t - 1, properties: { connector: props.connector, capability: props.capability, variant: props.variant } });
      }

      evs.push({ event: e.event, distinctId: uid, timestamp: Math.round(t0 + t), properties: props });

      if (e.event === 'confirm_shown') {
        for (const f of (props.fields as string[]) ?? []) {
          if (rand() < (p.corrections?.[f] ?? 0)) evs.push({ event: 'confirm_corrected', distinctId: uid, timestamp: Math.round(t0 + t + 1500), properties: { field: f, source: 'email_domain', variant: props.variant } });
        }
      }
      if (e.event === 'screen_viewed' && rand() < (p.dropOff?.[String(props.screen_id)] ?? 0)) abandoned = true;
    }

    if (!abandoned) {
      const last = evs.at(-1)!;
      const proofs = evs.filter((e) => e.event === 'proof_rendered');
      const proof = proofs[0];
      if (proof && rand() < (p.proofAcceptance?.[String(proof.properties.proof_id)] ?? 0.75)) {
        const ms = Number(last.timestamp - t0) + 4000 + rand() * 8000;
        evs.push({ event: 'aha_reached', distinctId: uid, timestamp: Math.round(t0 + ms), properties: { aha_event: suite.spec.aha.event, proof_id: proof.properties.proof_id, ms_since_start: Math.round(ms), variant: proof.properties.variant } });
      }
      for (const [setting, prob] of Object.entries(p.reconfigure ?? {})) {
        if (rand() < prob) evs.push({ event: 'setting_changed', distinctId: uid, timestamp: last.timestamp + 60_000, properties: { setting, set_by_onboarding: true, first_session: true, variant: last.properties.variant } });
      }
    }
    out.push(...evs);
  }
  return out;
}

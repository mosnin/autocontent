import { SCREEN_SECONDS, type OnboardingSpec } from '../../spec/src/index.ts';
import {
  browserEnricher,
  createOnboarding,
  emailDomainEnricher,
  oauthProfileEnricher,
  websiteEnricher,
  type ActivationReporter,
  type ActivationResult,
  type DashboardItem,
  type Enricher,
  type OnboardingState,
  type Signals,
  type WebsiteScan,
} from '../../core/src/index.ts';

/** A simulated user. Everything a real person would do or have, nothing more. */
export interface Persona {
  name: string;
  email: string;
  fullName?: string;
  /** OAuth identity provider: 'google', 'microsoft', 'github', 'gitlab', 'email'… */
  provider?: string;
  timezone?: string;
  utmSource?: string;
  /** What a website scan of their domain returns (detected pixels, currency, hero product…). */
  website?: WebsiteScan;
  /** ICP priors and other known signals. */
  signals?: Partial<Signals>;
  /** Per question: explicit option ids, or 'preselected' to accept what we pre-selected. */
  answers: Record<string, string[] | 'preselected'>;
  /** Edits made on the confirm screen. */
  corrections?: Record<string, unknown>;
  /** Values typed when a field is asked in context. */
  provide?: Record<string, unknown>;
  decisions?: Record<string, Record<string, string>>;
  /**
   * Connector behavior. `failFirst` = first attempt fails, the user retries once. `inferences` are
   * facts the verify call reads from the account (org, repo, currency…), like a real connector.
   */
  connectors?: Record<string, { fail?: string; failFirst?: string; seconds?: number; inferences?: { field: string; value: unknown; confidence?: number }[] }>;
  /** Skip optional secondary connects. */
  skipOptional?: boolean;
}

export interface ActivationFixture {
  /** Simulated seconds from enqueue to first result. */
  seconds: number;
  result?: ActivationResult;
  fail?: string;
}

export interface ReplayOptions {
  /** Fixture per capability id. Missing capabilities fall back to the spec's estimate with an empty result. */
  activations: Record<string, ActivationFixture>;
  /** Extra enrichers (the built-ins and a persona-driven website scan are always included). */
  enrichers?: Enricher[];
  /** Optional decision model (e.g. mockDecisions(), or a real Jev adapter) to replay the model-driven path. */
  decisions?: import('../../core/src/index.ts').DecisionAdapter;
  fieldMap?: Parameters<typeof oauthProfileEnricher>[0] & Parameters<typeof emailDomainEnricher>[0] & Parameters<typeof browserEnricher>[0];
}

export interface TimedEvent {
  t: number;
  event: string;
  properties: Record<string, unknown>;
}

export interface ReplayTrace {
  persona: string;
  completed: boolean;
  stuckAt?: { screen: string; reason: string };
  screens: { id: string; kind: string; enteredAt: number; fields: string[]; optional?: boolean }[];
  shownConnectors: string[];
  events: TimedEvent[];
  secondsToProof: number;
  totalSeconds: number;
  dashboard: DashboardItem[];
  state: OnboardingState;
  /** Whether outbound actions were blocked between connect and rehearsal, per capability. */
  outboundBlockedBeforeRehearsal: Record<string, boolean>;
  intendedCapabilities: string[];
}

/**
 * Run a persona through the real engine on a virtual clock. User time per screen comes from the
 * spec's estimates; activation time from fixtures. Deterministic: same input, same trace.
 */
export async function replay(spec: OnboardingSpec, persona: Persona, opts: ReplayOptions): Promise<ReplayTrace> {
  let t = 0;
  const events: TimedEvent[] = [];
  const pending: { due: number; capability: string; reporter: ActivationReporter }[] = [];
  const attempts: Record<string, number> = {};
  const outboundBlocked: Record<string, boolean> = {};

  const deliver = () => {
    pending.sort((a, b) => a.due - b.due);
    while (pending.length && pending[0]!.due <= t) {
      const job = pending.shift()!;
      const fx = opts.activations[job.capability];
      if (fx?.fail) job.reporter.fail(fx.fail);
      else job.reporter.done(fx?.result ?? { values: { count: 0 }, examples: [], source: 'own' });
    }
  };
  const advance = (seconds: number) => {
    t += seconds * 1000;
    deliver();
  };

  const map = opts.fieldMap;
  const ob = createOnboarding({
    spec,
    signals: persona.signals,
    adapters: {
      decisions: opts.decisions,
      clock: { now: () => t },
      analytics: { capture: (event, properties) => events.push({ t, event, properties }) },
      enrichers: [
        oauthProfileEnricher(map),
        emailDomainEnricher(map),
        browserEnricher(map),
        websiteEnricher(async () => persona.website, { websiteField: map?.website, businessNameField: map?.businessName }),
        ...(opts.enrichers ?? []),
      ],
      connectors: {
        async authorize() {},
        async verify(id) {
          attempts[id] = (attempts[id] ?? 0) + 1;
          const c = persona.connectors?.[id];
          if (c?.fail) return { ok: false, reason: c.fail };
          if (c?.failFirst && attempts[id] === 1) return { ok: false, reason: c.failFirst };
          return { ok: true, facts: [], inferences: (c?.inferences ?? []).map((i) => ({ field: i.field, value: i.value, source: `connector:${id}` as const, confidence: i.confidence ?? 0.95 })) };
        },
      },
      jobs: {
        enqueue(job, reporter) {
          const fx = opts.activations[job.capability];
          const cap = spec.capabilities.find((c) => c.id === job.capability);
          const seconds = fx?.seconds ?? cap?.activation.estSecondsToFirstResult ?? 30;
          reporter.progress({ label: 'Starting…', found: 0 });
          pending.push({ due: t + seconds * 1000, capability: job.capability, reporter });
        },
      },
    },
  });

  const screens: ReplayTrace['screens'] = [];
  const intended = new Set<string>();
  let stuckAt: ReplayTrace['stuckAt'];

  // Sign-in (OAuth round trip) happens before onboarding starts; its time still counts toward totals.
  advance(SCREEN_SECONDS.signin);
  const signinMs = SCREEN_SECONDS.signin * 1000;
  await ob.start({
    userId: `persona:${persona.name}`,
    email: persona.email,
    name: persona.fullName,
    provider: persona.provider,
    timezone: persona.timezone,
    utm: persona.utmSource ? { utm_source: persona.utmSource } : undefined,
  });

  for (let guard = 0; guard < 50 && ob.getState().phase !== 'complete'; guard++) {
    const { screen } = ob.view();
    screens.push({ id: screen.id, kind: screen.kind, enteredAt: t, fields: [...screen.fields], optional: screen.optional });

    switch (screen.kind) {
      case 'confirm': {
        advance(SCREEN_SECONDS.confirm);
        for (const [f, v] of Object.entries(persona.provide ?? {})) if (screen.fields.includes(f) && ob.getState().context[f] === undefined) ob.provide(f, v);
        ob.confirm(persona.corrections ?? {});
        break;
      }
      case 'intent': {
        const qid = screen.id.slice('intent:'.length);
        const { preselected, question } = ob.options(qid);
        const a = persona.answers[qid];
        const chosen = a === 'preselected' || a === undefined ? preselected : a;
        for (const o of question.options) if (chosen.includes(o.id)) o.capabilities.forEach((c) => intended.add(c));
        advance(SCREEN_SECONDS.intent);
        ob.answer(qid, chosen);
        break;
      }
      case 'connect': {
        const cid = screen.connector!;
        if (screen.optional && persona.skipOptional) {
          advance(2);
          ob.skip();
          continue;
        }
        const est = persona.connectors?.[cid]?.seconds ?? spec.connectors.find((c) => c.id === cid)?.estSeconds ?? SCREEN_SECONDS.connect;
        advance(est);
        await ob.connect(cid);
        if (ob.getState().connectors[cid] === 'failed' && persona.connectors?.[cid]?.failFirst) {
          advance(est);
          await ob.connect(cid);
        }
        // Probe the outbound gate right after verify: it must still be closed (RULES §4.4).
        if (screen.capability && spec.capabilities.find((c) => c.id === screen.capability)?.rehearsal.decisions.some((d) => d.gatesOutbound)) {
          try {
            ob.assertOutbound(screen.capability);
            outboundBlocked[screen.capability] = false;
          } catch {
            outboundBlocked[screen.capability] = true;
          }
        }
        if (ob.getState().connectors[cid] !== 'verified') {
          if (screen.optional || ob.view().canAdvance) {
            ob.skip();
            continue;
          }
          stuckAt = { screen: screen.id, reason: ob.view().blockedBy ?? 'connector failed' };
        }
        break;
      }
      case 'rehearsal': {
        advance(SCREEN_SECONDS.rehearsal);
        // If first results aren't in yet, the user waits on the rehearsal (skeleton) until they are.
        while (!ob.view().canAdvance && pending.length) {
          t = Math.max(t, pending[0]!.due);
          deliver();
        }
        for (const [f, v] of Object.entries(persona.provide ?? {})) if (screen.fields.includes(f)) ob.provide(f, v);
        for (const [d, o] of Object.entries(persona.decisions?.[screen.capability!] ?? {})) ob.decide(screen.capability!, d, o);
        break;
      }
      case 'invite':
      case 'consent': {
        advance(SCREEN_SECONDS[screen.kind]);
        for (const f of screen.fields) if (persona.provide?.[f] !== undefined) ob.provide(f, persona.provide[f]);
        break;
      }
      default:
        break;
    }

    if (stuckAt) break;
    const v = ob.view();
    if (!v.canAdvance) {
      stuckAt = { screen: screen.id, reason: v.blockedBy ?? 'cannot advance' };
      break;
    }
    ob.next();
  }

  const state = ob.getState();
  const firstProof = state.proofs[0];
  return {
    persona: persona.name,
    completed: state.phase === 'complete',
    stuckAt,
    screens,
    shownConnectors: screens.filter((s) => s.kind === 'connect').map((s) => s.id.slice('connect:'.length)),
    events,
    secondsToProof: firstProof ? (firstProof.renderedAt + signinMs) / 1000 : Number.POSITIVE_INFINITY,
    totalSeconds: (ob.elapsed() + signinMs) / 1000,
    dashboard: ob.dashboard(),
    state,
    outboundBlockedBeforeRehearsal: outboundBlocked,
    intendedCapabilities: [...intended],
  };
}

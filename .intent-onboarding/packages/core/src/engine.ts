import { derivePath, type CapabilityDef, type DerivedScreen, type IntentQuestion, type OnboardingSpec } from '../../spec/src/index.ts';
import { EMPTY_SIGNALS, isNoneOption, mergeSignals, preselect, rankOptions } from './preselect.ts';
import { renderStatement } from './proof.ts';
import { browserEnricher, emailDomainEnricher, oauthProfileEnricher } from './enrichers.ts';
import { decideWithin, type DecisionQuestion } from './decisions.ts';
import type {
  ActivationResult,
  CreateOnboardingOptions,
  DashboardItem,
  FieldValue,
  Inference,
  LedgerEntry,
  Listener,
  OnboardingState,
  ScreenView,
  SigninProfile,
} from './types.ts';

/** Inferences at or above this confidence are confirmed with one tap; below it they are asked. */
export const CONFIRM_THRESHOLD = 0.8;

export class OnboardingError extends Error {
  constructor(public readonly code: 'not_started' | 'wrong_screen' | 'cannot_advance' | 'unknown' | 'outbound_blocked', message: string) {
    super(message);
    this.name = 'OnboardingError';
  }
}

export type Onboarding = ReturnType<typeof createOnboarding>;

/**
 * Headless onboarding engine. Owns state, planning, activation and analytics; renders nothing.
 * Framework bindings (packages/react) subscribe to it; adapters connect it to the host.
 */
export function createOnboarding(opts: CreateOnboardingOptions) {
  const { spec, adapters } = opts;
  const clock = adapters.clock ?? { now: () => Date.now() };
  const listeners = new Set<Listener>();
  const committedDecisions = new Set<string>();
  let screenEnteredAt = 0;
  let ledgerSeq = 0;

  let state: OnboardingState = {
    phase: 'idle',
    context: {},
    signals: mergeSignals(EMPTY_SIGNALS, opts.signals),
    answers: {},
    preselected: {},
    preselectScores: {},
    path: derivePath(spec, []),
    screenIndex: 0,
    connectors: Object.fromEntries(spec.connectors.map((c) => [c.id, 'idle' as const])),
    activations: {},
    decisions: {},
    proofs: [],
    ledger: [],
    history: [],
  };

  // ── internals ─────────────────────────────────────────────────────────────

  const capById = new Map(spec.capabilities.map((c) => [c.id, c]));
  const questionById = new Map(spec.intents.map((q) => [q.id, q]));
  const fieldIds = new Set(spec.fields.map((f) => f.id));
  /** Built-in enrichers run when the host supplies none: OAuth profile, email domain, browser. */
  const enrichers = adapters.enrichers ?? [oauthProfileEnricher(), emailDomainEnricher(), browserEnricher()];
  const decisionTimeoutMs = opts.decisionTimeoutMs ?? 1500;
  const preselectThreshold = opts.preselectThreshold ?? CONFIRM_THRESHOLD;
  const elapsed = () => (state.startedAt === undefined ? 0 : clock.now() - state.startedAt);

  function set(patch: Partial<OnboardingState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
    if (adapters.storage && state.userId) {
      const { path: _path, ...snapshot } = state;
      void adapters.storage.save(state.userId, snapshot).catch(() => {});
    }
  }

  function capture(event: string, properties: Record<string, unknown> = {}) {
    adapters.analytics?.capture(event, { flow_version: opts.flowVersion ?? '1', variant: opts.variant ?? 'intent', ...properties });
  }

  function log(action: string, detail: string, undo?: LedgerEntry['undo']) {
    const entry: LedgerEntry = { id: `l${++ledgerSeq}`, at: elapsed(), action, detail, undo };
    set({ ledger: [...state.ledger, entry] });
  }

  function writeField(field: string, value: FieldValue, why: string) {
    const previous = state.context[field];
    set({ context: { ...state.context, [field]: value } });
    log('set_field', `${field} ← ${JSON.stringify(value.value)} (${why})`, { field, previous });
  }

  function applyInferences(inferences: Inference[]) {
    for (const inf of inferences) {
      if (!fieldIds.has(inf.field)) continue; // only fields the spec declares
      const current = state.context[inf.field];
      if (current?.confirmed) continue; // never overwrite what the user accepted
      if (current && current.confidence >= inf.confidence) continue;
      writeField(inf.field, { value: inf.value, source: inf.source, confidence: inf.confidence, confirmed: false }, inf.source);
      capture('context_inferred', { field: inf.field, source: inf.source, confidence: inf.confidence });
    }
  }

  function chosenOptions(): string[] {
    return Object.values(state.answers).flat();
  }

  function replan() {
    const currentId = state.path.screens[state.screenIndex]?.id;
    const path = derivePath(spec, chosenOptions());
    const idx = currentId ? path.screens.findIndex((s) => s.id === currentId) : 0;
    set({ path, screenIndex: Math.max(0, idx) });
  }

  function current(): DerivedScreen {
    const s = state.path.screens[state.screenIndex];
    if (!s) throw new OnboardingError('unknown', 'No current screen.');
    return s;
  }

  function enterScreen() {
    screenEnteredAt = clock.now();
    const s = state.path.screens[state.screenIndex];
    if (!s) return;
    capture('screen_viewed', { screen_id: s.id, kind: s.kind, purpose: s.purpose, index: state.screenIndex });
    if (s.kind === 'intent') {
      const q = questionById.get(s.id.slice('intent:'.length));
      if (q && !state.preselected[q.id]) set({ preselected: { ...state.preselected, [q.id]: preselect(q, state.signals) } });
    }
    if (s.kind === 'rehearsal' && s.capability) applyDecisionDefaults(s.capability);
    if (s.kind === 'confirm') capture('confirm_shown', { fields: s.fields });
    if (s.kind === 'handoff') complete();
  }

  function applyDecisionDefaults(capId: string) {
    const cap = capById.get(capId);
    if (!cap || state.decisions[capId]) return;
    const defaults = Object.fromEntries(cap.rehearsal.decisions.map((d) => [d.id, d.default]));
    set({ decisions: { ...state.decisions, [capId]: defaults } });
  }

  const label = (fieldId: string) => spec.fields.find((f) => f.id === fieldId)?.label.toLowerCase() ?? fieldId;

  function requiredFieldsMissing(fields: string[]): string[] {
    return fields.filter((f) => state.context[f]?.value === undefined || state.context[f]?.value === '');
  }

  function evaluate(s: DerivedScreen): { ok: boolean; reason?: string } {
    switch (s.kind) {
      case 'signin':
        return state.phase === 'idle' ? { ok: false, reason: 'Sign in to continue' } : { ok: true };
      case 'confirm': {
        // Confirm runs before intent, so it only blocks on fields the spec asks *here*. Everything
        // else resolves later: from a connector, or asked in context on the rehearsal.
        const askedHere = s.fields.filter((f) => {
          const def = spec.fields.find((x) => x.id === f);
          return def?.tier === 'blocking' && def.askInContext?.on === 'confirm';
        });
        const missing = requiredFieldsMissing(askedHere);
        return missing.length ? { ok: false, reason: `Add ${missing.map(label).join(', ')}` } : { ok: true };
      }
      case 'intent': {
        const q = s.id.slice('intent:'.length);
        return state.answers[q]?.length ? { ok: true } : { ok: false, reason: 'Choose at least one' };
      }
      case 'connect': {
        const st = state.connectors[s.connector!];
        if (st === 'verified' || st === 'skipped') return { ok: true };
        if (s.optional) return { ok: true }; // optional steps can always be skipped (RULES §7.4)
        if (st === 'failed') {
          const cap = capById.get(s.capability!);
          return cap?.proof.fallback || cap?.zeroSetup ? { ok: true } : { ok: false, reason: 'Reconnect to continue' };
        }
        return { ok: false, reason: 'Connect to continue' };
      }
      case 'rehearsal': {
        const act = state.activations[s.capability!];
        const cap = capById.get(s.capability!);
        // Blocking fields still missing for this capability (e.g. the org when no connector supplied it).
        const missing = requiredFieldsMissing((cap?.fields ?? []).filter((f) => spec.fields.find((x) => x.id === f)?.tier === 'blocking'));
        if (missing.length) return { ok: false, reason: `Add ${missing.map(label).join(', ')}` };
        if (act?.status === 'done') return { ok: true };
        if (act?.status === 'failed' && cap?.proof.fallback) return { ok: true };
        // Zero-connector capabilities start on entry; others start at verify.
        return { ok: false, reason: 'Finding your first results…' };
      }
      case 'invite':
      case 'consent': {
        const missing = requiredFieldsMissing(s.fields);
        return missing.length ? { ok: false, reason: `Add ${missing.join(', ')}` } : { ok: true };
      }
      case 'handoff':
        return { ok: true };
    }
  }

  function startActivation(cap: CapabilityDef) {
    if (state.activations[cap.id] && state.activations[cap.id]!.status !== 'failed') return;
    const startedAt = elapsed();
    set({ activations: { ...state.activations, [cap.id]: { status: 'running', startedAt } } });
    capture('activation_started', { capability: cap.id, activation: cap.activation.id, ms_since_start: startedAt });
    log('activation_started', cap.activation.description);
    adapters.jobs.enqueue(
      { capability: cap.id, activation: cap.activation.id, userId: state.userId ?? '', context: state.context },
      {
        progress: (p) => {
          const a = state.activations[cap.id];
          if (a?.status !== 'running') return;
          set({ activations: { ...state.activations, [cap.id]: { ...a, progress: p } } });
        },
        done: (result) => finishActivation(cap, result),
        fail: (reason) => {
          const a = state.activations[cap.id];
          set({ activations: { ...state.activations, [cap.id]: { ...a, status: 'failed', error: reason } } });
          if (cap.proof.fallback) {
            renderProof(cap, { values: {}, examples: [], source: cap.proof.fallback.source }, cap.proof.fallback.statement);
          }
        },
      },
    );
  }

  function finishActivation(cap: CapabilityDef, result: ActivationResult) {
    const a = state.activations[cap.id];
    set({ activations: { ...state.activations, [cap.id]: { ...a, status: 'done', result } } });
    renderProof(cap, result);
  }

  function renderProof(cap: CapabilityDef, result: ActivationResult, template = cap.proof.statement) {
    if (state.proofs.some((p) => p.proofId === cap.proof.id)) return;
    const item = {
      proofId: cap.proof.id,
      capability: cap.id,
      statement: renderStatement(template, result.values),
      cta: cap.proof.cta,
      source: result.source,
      renderedAt: elapsed(),
    };
    set({ proofs: [...state.proofs, item] });
    capture('proof_rendered', { proof_id: item.proofId, capability: cap.id, value: result.values.count ?? null, source: result.source, ms_since_start: item.renderedAt });
  }

  function complete() {
    if (state.phase === 'complete') return;
    set({ phase: 'complete' });
    const p = state.path;
    capture('onboarding_completed', { screens: p.screenCount, duration_ms: elapsed(), primary: p.primary, secondary: p.secondary, deferred: p.deferred });
    capture('dashboard_first_load', { proof_items: state.proofs.length, ms_since_start: elapsed() });
  }

  function leave(s: DerivedScreen, skipped: boolean) {
    const ms = clock.now() - screenEnteredAt;
    set({ history: [...state.history, { screenId: s.id, ms, skipped }] });
    capture('screen_completed', { screen_id: s.id, kind: s.kind, duration_ms: ms, skipped });
    if (s.kind === 'rehearsal' && s.capability) {
      committedDecisions.add(s.capability);
      const cap = capById.get(s.capability)!;
      for (const d of cap.rehearsal.decisions) {
        const option = state.decisions[s.capability]?.[d.id] ?? d.default;
        capture('decision_made', { capability: s.capability, decision: d.id, option, default_kept: option === d.default });
        log('decision', `${s.capability}.${d.id} = ${option}`);
      }
    }
    set({ screenIndex: Math.min(state.screenIndex + 1, state.path.screens.length - 1) });
    const next = state.path.screens[state.screenIndex];
    // Zero-connector capabilities (e.g. public competitor scan) activate on entering their rehearsal.
    if (next?.kind === 'rehearsal' && next.capability) {
      const cap = capById.get(next.capability)!;
      if (cap.connectors.length === 0) startActivation(cap);
    }
    enterScreen();
  }

  /** Ask the decision model, once, how likely each intent option is for this business. */
  async function scorePreselection(): Promise<Record<string, Record<string, number>>> {
    if (!adapters.decisions) return {};
    const questions: Record<string, DecisionQuestion> = {};
    for (const q of spec.intents) {
      for (const o of q.options) {
        if (isNoneOption(o)) continue; // never pre-select "I don't do this today"
        questions[`${q.id}__${o.id}`] = { type: 'yesno', instructions: `${q.prompt} Based on what we know about this business, is "${o.label}" part of the answer?` };
      }
    }
    const r = await decideWithin(adapters.decisions, businessState(), questions, decisionTimeoutMs);
    capture('decision_scored', { purpose: 'preselect', latency_ms: r.ms, ok: r.ok, questions: Object.keys(questions).length, reason: r.reason ?? null });
    if (!r.answers) return {};
    const out: Record<string, Record<string, number>> = {};
    for (const [key, a] of Object.entries(r.answers)) {
      const [qid, oid] = key.split('__') as [string, string];
      (out[qid] ??= {})[oid] = (a as { probability: number }).probability;
    }
    return out;
  }

  /** What the decision model sees: what enrichment learned, never raw personal data beyond the domain. */
  function businessState() {
    const s = state.signals;
    return {
      business: Object.fromEntries(Object.entries(state.context).filter(([, v]) => v.source !== 'oauth_profile').map(([k, v]) => [k, v.value])),
      website_summary: s.siteSummary ?? null,
      detected_on_website: s.websiteDetects,
      email_domain: s.emailDomain ?? null,
      signed_in_with: s.oauthProviders,
    };
  }

  // ── public API ────────────────────────────────────────────────────────────

  return {
    spec,

    getState: () => state,

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** The screen the user is on, whether they can move on, and why not. */
    view(): ScreenView {
      const s = current();
      const e = evaluate(s);
      return { screen: s, index: state.screenIndex, total: state.path.screenCount, canAdvance: e.ok, blockedBy: e.reason };
    },

    /** Options for an intent question, ranked, with pre-selection applied. */
    options(questionId: string) {
      const q = questionById.get(questionId);
      if (!q) throw new OnboardingError('unknown', `Unknown question "${questionId}".`);
      return { question: q as IntentQuestion, options: rankOptions(q, state.signals), preselected: state.preselected[questionId] ?? preselect(q, state.signals) };
    },

    /**
     * Map a free-text "Other" answer ("mostly instagram, some email") to the question's options.
     * Uses the decision model when present (within the timeout); otherwise label matching.
     */
    async interpretOther(questionId: string, text: string): Promise<string[]> {
      const q = questionById.get(questionId);
      if (!q || !text.trim()) return [];
      const fallback = () => {
        const t = text.toLowerCase();
        return q.options.filter((o) => !isNoneOption(o) && o.label.toLowerCase().split(/[\s/]+/).some((w) => w.length > 2 && t.includes(w))).map((o) => o.id);
      };
      if (!adapters.decisions) return fallback();
      const questions: Record<string, DecisionQuestion> =
        q.kind === 'single'
          ? { pick: { type: 'choice', instructions: `The user was asked "${q.prompt}" and answered in their own words. Which option matches?`, options: Object.fromEntries(q.options.map((o) => [o.id, o.label])) } }
          : Object.fromEntries(q.options.filter((o) => !isNoneOption(o)).map((o) => [o.id, { type: 'yesno', instructions: `The user was asked "${q.prompt}" and answered in their own words. Does their answer include "${o.label}"?` }]));
      const r = await decideWithin(adapters.decisions, { answer: text }, questions, decisionTimeoutMs);
      capture('decision_scored', { purpose: 'interpret_other', latency_ms: r.ms, ok: r.ok, reason: r.reason ?? null });
      if (!r.answers) return fallback();
      if (q.kind === 'single') {
        const a = r.answers.pick as { choice: string; confidence: number } | undefined;
        return a && a.confidence >= 0.5 ? [a.choice] : fallback();
      }
      return Object.entries(r.answers).filter(([, a]) => (a as { probability: number }).probability >= 0.5).map(([id]) => id);
    },

    /** Sign-in finished: run enrichment and move to the first real screen. */
    async start(profile: SigninProfile) {
      set({ phase: 'running', userId: profile.userId, startedAt: clock.now() });
      capture('onboarding_started', { entry: profile.provider ?? 'email' });
      for (const enrich of enrichers) {
        try {
          const r = await enrich({ profile, context: state.context, signals: state.signals });
          set({ signals: mergeSignals(state.signals, r.signals) });
          applyInferences(r.inferences);
        } catch {
          // Enrichment is best-effort; a failure means we ask instead of confirm.
        }
      }
      // Pre-select: rules first (pixels, OAuth provider, ICP share), then the decision model's
      // calibrated probabilities for everything else. The model never removes a rule-based pick.
      const preselected: Record<string, string[]> = Object.fromEntries(spec.intents.map((q) => [q.id, preselect(q, state.signals)]));
      const scores = await scorePreselection();
      for (const q of spec.intents) {
        const s = scores[q.id];
        if (!s) continue;
        const confident = q.options.filter((o) => (s[o.id] ?? 0) >= preselectThreshold).sort((a, b) => (s[b.id] ?? 0) - (s[a.id] ?? 0)).map((o) => o.id);
        const merged = [...new Set([...preselected[q.id]!, ...confident])];
        preselected[q.id] = q.kind === 'single' ? merged.slice(0, 1) : merged;
      }
      set({ preselected, preselectScores: scores });
      set({ history: [...state.history, { screenId: 'signin', ms: 0, skipped: false }] });
      capture('screen_completed', { screen_id: 'signin', kind: 'signin', duration_ms: 0, skipped: false });
      set({ screenIndex: 1 });
      enterScreen();
    },

    /** Accept inferred facts on the confirm screen, optionally with edits. */
    confirm(edits: Record<string, unknown> = {}) {
      const s = current();
      if (s.kind !== 'confirm') throw new OnboardingError('wrong_screen', `confirm() on "${s.id}".`);
      const context = { ...state.context };
      for (const f of s.fields) {
        if (f in edits) {
          const before = context[f];
          writeField(f, { value: edits[f], source: 'answer', confidence: 1, confirmed: true }, 'edited on confirm');
          if (before) capture('confirm_corrected', { field: f, source: before.source });
        } else if (context[f]) {
          set({ context: { ...state.context, [f]: { ...context[f]!, confirmed: true } } });
        }
      }
    },

    /** Value for a field asked in context (signature preview, invite list…). */
    provide(field: string, value: unknown) {
      writeField(field, { value, source: 'answer', confidence: 1, confirmed: true }, 'asked in context');
    },

    /** Answer an intent question. Re-plans the remaining screens. */
    answer(questionId: string, optionIds: string[], otherText?: string) {
      const q = questionById.get(questionId);
      if (!q) throw new OnboardingError('unknown', `Unknown question "${questionId}".`);
      const valid = optionIds.filter((id) => q.options.some((o) => o.id === id));
      const picked = q.kind === 'single' ? valid.slice(0, 1) : valid;
      set({ answers: { ...state.answers, [questionId]: picked } });
      if (q.fills && picked[0]) writeField(q.fills, { value: picked[0], source: 'answer', confidence: 1, confirmed: true }, `answered ${q.id}`);
      const pre = state.preselected[questionId] ?? [];
      capture('intent_answered', { question: q.id, options: picked, preselected: pre, preselected_kept: pre.filter((p) => picked.includes(p)), other_text: otherText ?? null });
      log('intent', `${q.id}: ${picked.join(', ') || '(none)'}`);
      replan();
    },

    /** Connect a connector shown on the current screen. Verify, then start activation within the same tick. */
    async connect(connectorId: string) {
      const s = current();
      if (s.kind !== 'connect' || s.connector !== connectorId) throw new OnboardingError('wrong_screen', `connect("${connectorId}") on "${s.id}". Only intent-implied connectors can be connected here (RULES §2.3).`);
      const cap = capById.get(s.capability!)!;
      const t0 = clock.now();
      set({ connectors: { ...state.connectors, [connectorId]: 'authorizing' } });
      capture('connector_started', { connector: connectorId, capability: cap.id });
      try {
        await adapters.connectors.authorize(connectorId);
        set({ connectors: { ...state.connectors, [connectorId]: 'verifying' } });
        const v = await adapters.connectors.verify(connectorId);
        if (!v.ok) throw new Error(v.reason);
        set({
          connectors: { ...state.connectors, [connectorId]: 'verified' },
          signals: mergeSignals(state.signals, { connectorFacts: { [`connector:${connectorId}`]: v.facts ?? [] } }),
        });
        applyInferences(v.inferences ?? []);
        capture('connector_verified', { connector: connectorId, capability: cap.id, duration_ms: clock.now() - t0 });
        log('connected', `${connectorId} verified`);
        startActivation(cap); // RULES §4.2: activation starts at verify
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        set({ connectors: { ...state.connectors, [connectorId]: 'failed' } });
        capture('connector_failed', { connector: connectorId, capability: cap.id, reason });
      }
    },

    /** Record a rehearsal decision. Decisions become real product configuration on advance. */
    decide(capabilityId: string, decisionId: string, optionId: string) {
      const cap = capById.get(capabilityId);
      const d = cap?.rehearsal.decisions.find((x) => x.id === decisionId);
      if (!cap || !d || !d.options.some((o) => o.id === optionId)) throw new OnboardingError('unknown', `Unknown decision ${capabilityId}.${decisionId}=${optionId}.`);
      applyDecisionDefaults(capabilityId);
      set({ decisions: { ...state.decisions, [capabilityId]: { ...state.decisions[capabilityId], [decisionId]: optionId } } });
    },

    /** Advance to the next screen. Throws if the current screen isn't satisfied. */
    next() {
      const s = current();
      const e = evaluate(s);
      if (!e.ok) throw new OnboardingError('cannot_advance', e.reason ?? 'Cannot advance');
      leave(s, false);
    },

    /** Skip an optional screen (secondary connector) or a failed connect with a fallback. */
    skip() {
      const s = current();
      if (s.kind === 'connect') {
        const cap = capById.get(s.capability!);
        const allowed = s.optional || (state.connectors[s.connector!] === 'failed' && (cap?.proof.fallback || cap?.zeroSetup));
        if (!allowed) throw new OnboardingError('cannot_advance', 'This step is required.');
        if (state.connectors[s.connector!] !== 'verified') set({ connectors: { ...state.connectors, [s.connector!]: 'skipped' } });
        leave(s, true);
        return;
      }
      throw new OnboardingError('cannot_advance', `Screen "${s.id}" can't be skipped.`);
    },

    /** Activation callbacks for hosts whose job runner reports out-of-band (webhooks, realtime). */
    reportActivation(capabilityId: string, result: ActivationResult) {
      const cap = capById.get(capabilityId);
      if (cap) finishActivation(cap, result);
    },

    /**
     * Server-side outbound gate (RULES §4.4). Returns the chosen mode once the rehearsal that
     * owns the gating decision is complete; throws before that.
     */
    assertOutbound(capabilityId: string): string {
      const cap = capById.get(capabilityId);
      const gate = cap?.rehearsal.decisions.find((d) => d.gatesOutbound);
      if (!cap || !gate) throw new OnboardingError('outbound_blocked', `"${capabilityId}" has no outbound gate.`);
      if (!committedDecisions.has(capabilityId)) throw new OnboardingError('outbound_blocked', `Outbound for "${capabilityId}" is blocked until the user decides "${gate.prompt}".`);
      return state.decisions[capabilityId]?.[gate.id] ?? gate.default;
    },

    /** The first dashboard view: proof first, then what needs input, then suggestions. Never empty. */
    dashboard(): DashboardItem[] {
      const items: DashboardItem[] = state.proofs.map((p) => ({
        kind: 'proof',
        title: p.statement,
        detail: p.source === 'sample' ? 'Sample data' : p.source === 'public' ? 'From public data' : undefined,
        cta: p.cta,
        status: 'info',
      }));
      for (const [id, st] of Object.entries(state.connectors)) {
        if (st === 'failed') {
          const name = spec.connectors.find((c) => c.id === id)?.name ?? id;
          items.push({ kind: 'needs_input', title: `${name} didn't connect`, detail: 'Reconnect to finish setup', status: 'danger', cta: { label: 'Reconnect', event: 'reconnect_clicked' } });
        }
      }
      for (const [capId, a] of Object.entries(state.activations)) {
        if (a.status === 'running') items.push({ kind: 'needs_input', title: a.progress?.label ?? `${capById.get(capId)?.label} is still working`, detail: 'Results land here as they arrive', status: 'info' });
      }
      for (const capId of state.path.deferred) {
        const cap = capById.get(capId);
        if (cap) items.push({ kind: 'suggestion', title: `Add ${cap.label}`, detail: cap.activation.description, cta: { label: 'Connect', event: 'suggestion_connect' } });
      }
      return items;
    },

    /** Call when the user acts on a proof CTA: the aha. */
    aha(proofId: string) {
      const proof = state.proofs.find((p) => p.proofId === proofId);
      if (!proof) throw new OnboardingError('unknown', `No rendered proof "${proofId}".`);
      capture('aha_reached', { aha_event: proof.cta.event, proof_id: proofId, ms_since_start: elapsed() });
      capture(proof.cta.event, { proof_id: proofId });
    },

    /** Report a settings change, so first-session reconfiguration can be measured. */
    settingChanged(setting: string, opts2: { firstSession?: boolean } = {}) {
      const setByOnboarding = setting in state.context || Object.values(state.decisions).some((d) => setting in d);
      capture('setting_changed', { setting, set_by_onboarding: setByOnboarding, first_session: opts2.firstSession ?? true });
    },

    /** Undo a ledger entry that changed a field. */
    undo(entryId: string) {
      const entry = state.ledger.find((e) => e.id === entryId);
      if (!entry?.undo?.field) throw new OnboardingError('unknown', `Entry "${entryId}" can't be undone.`);
      const context = { ...state.context };
      if (entry.undo.previous) context[entry.undo.field] = entry.undo.previous;
      else delete context[entry.undo.field];
      set({ context });
      log('undo', `reverted ${entry.undo.field}`);
    },

    /** Elapsed ms since onboarding started. */
    elapsed,
  };
}

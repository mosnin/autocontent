/**
 * React bindings for the headless onboarding engine.
 *
 * Thin by design: every hook is a selector over engine state via useSyncExternalStore, plus
 * bound actions. No styling, no data fetching. Pair with packages/ui or the host's components.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isNoneOption, type ActivationState, type ConnectorStatus, type Onboarding, type OnboardingState, type ProofItem, type ScreenView } from '../../core/src/index.ts';
import type { CapabilityDef, ConnectorDef, IntentOption, IntentQuestion } from '../../spec/src/index.ts';

const OnboardingContext = createContext<Onboarding | null>(null);

export function OnboardingProvider({ onboarding, children }: { onboarding: Onboarding; children: ReactNode }) {
  return <OnboardingContext.Provider value={onboarding}>{children}</OnboardingContext.Provider>;
}

export function useOnboardingEngine(): Onboarding {
  const ob = useContext(OnboardingContext);
  if (!ob) throw new Error('useOnboarding* hooks must be used inside <OnboardingProvider>.');
  return ob;
}

/** Subscribe to a slice of engine state. Re-renders only when the selected value changes. */
export function useOnboardingSelector<T>(selector: (s: OnboardingState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const ob = useOnboardingEngine();
  const last = useRef<{ value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const next = selector(ob.getState());
    if (last.current && isEqual(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  }, [ob, selector, isEqual]);
  return useSyncExternalStore(ob.subscribe, getSnapshot, getSnapshot);
}

export function useOnboardingState(): OnboardingState {
  return useOnboardingSelector(useCallback((s: OnboardingState) => s, []));
}

/** The current screen, whether the user can continue, and navigation. */
export function useScreen(): ScreenView & { next: () => void; skip: () => void } {
  const ob = useOnboardingEngine();
  useOnboardingState(); // re-render on any change; view() is cheap and derived
  const view = ob.view();
  return { ...view, next: ob.next, skip: ob.skip };
}

export interface IntentBinding {
  question: IntentQuestion;
  /** Options ranked: pre-selected first, "not yet" last. */
  options: IntentOption[];
  preselected: string[];
  /** Current selection (starts as the pre-selection). */
  selected: string[];
  toggle: (optionId: string) => void;
  submit: (otherText?: string) => void;
}

/** Bind a multiple-choice intent question. Selection starts from the pre-selection. */
export function useIntent(questionId: string): IntentBinding {
  const ob = useOnboardingEngine();
  const answered = useOnboardingSelector(useCallback((s: OnboardingState) => s.answers[questionId], [questionId]));
  const preselectedState = useOnboardingSelector(useCallback((s: OnboardingState) => s.preselected[questionId], [questionId]));
  const { question, options, preselected } = useMemo(() => ob.options(questionId), [ob, questionId, preselectedState]);
  const [draft, setDraft] = useState<string[] | null>(null);
  const selected = answered ?? draft ?? preselected;

  const toggle = useCallback(
    (id: string) => {
      setDraft((prev) => {
        const cur = prev ?? answered ?? preselected;
        const option = question.options.find((o) => o.id === id);
        if (question.kind === 'single') return [id];
        if (cur.includes(id)) return cur.filter((x) => x !== id);
        if (option && isNoneOption(option)) return [id]; // "not yet" is exclusive
        return [...cur.filter((x) => { const o = question.options.find((y) => y.id === x); return o && !isNoneOption(o); }), id];
      });
    },
    [answered, preselected, question],
  );

  const submit = useCallback(
    (otherText?: string) => {
      ob.answer(questionId, draft ?? answered ?? preselected, otherText);
      setDraft(null);
    },
    [ob, questionId, draft, answered, preselected],
  );

  return { question, options, preselected, selected, toggle, submit };
}

export interface ConnectorBinding {
  connector: ConnectorDef;
  capability?: CapabilityDef;
  status: ConnectorStatus;
  activation?: ActivationState;
  connect: () => Promise<void>;
}

export function useConnector(connectorId: string, capabilityId?: string): ConnectorBinding {
  const ob = useOnboardingEngine();
  const status = useOnboardingSelector(useCallback((s: OnboardingState) => s.connectors[connectorId] ?? 'idle', [connectorId]));
  const activation = useOnboardingSelector(useCallback((s: OnboardingState) => (capabilityId ? s.activations[capabilityId] : undefined), [capabilityId]));
  const connector = ob.spec.connectors.find((c) => c.id === connectorId)!;
  const capability = capabilityId ? ob.spec.capabilities.find((c) => c.id === capabilityId) : undefined;
  return { connector, capability, status, activation, connect: () => ob.connect(connectorId) };
}

export interface RehearsalBinding {
  capability: CapabilityDef;
  activation?: ActivationState;
  example: unknown;
  decisions: Record<string, string>;
  decide: (decisionId: string, optionId: string) => void;
}

export function useRehearsal(capabilityId: string): RehearsalBinding {
  const ob = useOnboardingEngine();
  const activation = useOnboardingSelector(useCallback((s: OnboardingState) => s.activations[capabilityId], [capabilityId]));
  const decisions = useOnboardingSelector(useCallback((s: OnboardingState) => s.decisions[capabilityId] ?? {}, [capabilityId]));
  const capability = ob.spec.capabilities.find((c) => c.id === capabilityId)!;
  const defaults = Object.fromEntries(capability.rehearsal.decisions.map((d) => [d.id, d.default]));
  return {
    capability,
    activation,
    example: activation?.result?.examples[0],
    decisions: { ...defaults, ...decisions },
    decide: (d, o) => ob.decide(capabilityId, d, o),
  };
}

export function useProofs(): ProofItem[] {
  return useOnboardingSelector(useCallback((s: OnboardingState) => s.proofs, []));
}

/** A field's value plus confirm/provide actions, for confirm cards and in-context asks. */
export function useField(fieldId: string) {
  const ob = useOnboardingEngine();
  const value = useOnboardingSelector(useCallback((s: OnboardingState) => s.context[fieldId], [fieldId]));
  const def = ob.spec.fields.find((f) => f.id === fieldId);
  return { def, value, provide: (v: unknown) => ob.provide(fieldId, v) };
}

/**
 * Keyboard-first navigation (DESIGN D15): number keys pick options, Enter continues, Esc skips.
 * Ignores keystrokes while the user is typing in an input.
 */
export function useOnboardingKeys(handlers: { onNumber?: (n: number) => void; onEnter?: () => void; onEscape?: () => void }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key) && ref.current.onNumber) {
        e.preventDefault();
        ref.current.onNumber(Number(e.key));
      } else if (e.key === 'Enter' && ref.current.onEnter) {
        e.preventDefault();
        ref.current.onEnter();
      } else if (e.key === 'Escape' && ref.current.onEscape) {
        e.preventDefault();
        ref.current.onEscape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

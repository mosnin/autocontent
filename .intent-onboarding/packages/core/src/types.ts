import type { DerivedPath, DerivedScreen, InferSource, OnboardingEventName, OnboardingSpec } from '../../spec/src/index.ts';
import type { DecisionAdapter } from './decisions.ts';

// ─── Context graph ──────────────────────────────────────────────────────────

export type FieldSource = InferSource | 'answer' | 'decision';

export interface FieldValue {
  value: unknown;
  source: FieldSource;
  /** 0–1. ≥ CONFIRM_THRESHOLD is shown as a one-tap confirm; below it, the field is asked. */
  confidence: number;
  /** True once the user has seen and accepted (or edited) the value. */
  confirmed: boolean;
}

export type ContextGraph = Record<string, FieldValue>;

/** Facts about the user's environment that drive pre-selection (RULES §2.2). */
export interface Signals {
  /** Tech detected on the user's website, e.g. 'meta_pixel', 'shopify', 'instagram_link'. */
  websiteDetects: string[];
  emailDomain?: string;
  /** OAuth identity provider(s), e.g. 'google', 'microsoft'. */
  oauthProviders: string[];
  /** Share of matching ICP customers who use each intent option, 0–1. */
  icpOptionShare: Record<string, number>;
  /** Facts read from verified connectors, keyed `connector:<id>`. */
  connectorFacts: Record<string, string[]>;
  /** Short description of the business from the website scan, for decision models. */
  siteSummary?: string;
}

// ─── Adapters (the host implements these; reference/mock versions ship) ──────

export interface SigninProfile {
  userId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  provider?: string;
  timezone?: string;
  locale?: string;
  utm?: Record<string, string>;
}

export interface Inference {
  field: string;
  value: unknown;
  source: InferSource;
  confidence: number;
}

export interface EnrichmentResult {
  inferences: Inference[];
  signals?: Partial<Signals>;
}

/** Runs at signin, in parallel with the OAuth redirect. */
export type Enricher = (input: { profile: SigninProfile; context: ContextGraph; signals: Signals }) => Promise<EnrichmentResult>;

export interface ConnectorAdapter {
  /** Start the OAuth/API-key flow. Resolves when the user has granted access (or rejects). */
  authorize(connectorId: string): Promise<void>;
  /**
   * Make the connector's first authenticated call (RULES §4.5). May return facts and
   * inferences read from the account (currency, timezone, account names).
   */
  verify(connectorId: string): Promise<{ ok: true; facts?: string[]; inferences?: Inference[] } | { ok: false; reason: string }>;
}

export interface ActivationProgress {
  /** Human-readable live line, e.g. "Reading conversations… 212". */
  label: string;
  /** Running count of items found so far. */
  found?: number;
  /** Items scanned so far. */
  scanned?: number;
}

export interface ActivationResult {
  /** Values for the proof statement placeholders, e.g. { count: 14 }. */
  values: Record<string, string | number>;
  /** Real example items for the rehearsal (first is used). */
  examples: unknown[];
  /** Whether results came from the user's own data, public data or labeled sample data. */
  source: 'own' | 'public' | 'sample';
}

export interface ActivationReporter {
  progress(p: ActivationProgress): void;
  done(result: ActivationResult): void;
  fail(reason: string): void;
}

export interface JobsAdapter {
  /**
   * Enqueue the capability's activation in a durable job runner and return immediately.
   * The job reports back through `reporter` (in production: via the host's realtime channel).
   */
  enqueue(job: { capability: string; activation: string; userId: string; context: ContextGraph }, reporter: ActivationReporter): void;
}

export interface AnalyticsAdapter {
  capture(event: OnboardingEventName | string, properties: Record<string, unknown>): void;
}

export interface StorageAdapter {
  load(userId: string): Promise<OnboardingSnapshot | undefined>;
  save(userId: string, snapshot: OnboardingSnapshot): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface Adapters {
  connectors: ConnectorAdapter;
  jobs: JobsAdapter;
  enrichers?: Enricher[];
  analytics?: AnalyticsAdapter;
  storage?: StorageAdapter;
  clock?: Clock;
  /** Optional decision model (e.g. Jev). Every use has a timeout and a rule-based fallback. */
  decisions?: DecisionAdapter;
}

// ─── Engine state ───────────────────────────────────────────────────────────

export type ConnectorStatus = 'idle' | 'authorizing' | 'verifying' | 'verified' | 'failed' | 'skipped';

export interface ActivationState {
  status: 'idle' | 'running' | 'done' | 'failed';
  startedAt?: number;
  progress?: ActivationProgress;
  result?: ActivationResult;
  error?: string;
}

export interface ProofItem {
  proofId: string;
  capability: string;
  statement: string;
  cta: { label: string; event: string };
  source: 'own' | 'public' | 'sample';
  renderedAt: number;
}

export interface LedgerEntry {
  id: string;
  at: number;
  action: string;
  detail: string;
  /** Present when the action can be undone. */
  undo?: { field?: string; previous?: FieldValue | undefined };
}

export interface DashboardItem {
  kind: 'proof' | 'needs_input' | 'suggestion';
  title: string;
  detail?: string;
  cta?: { label: string; event: string };
  status?: 'info' | 'warning' | 'danger';
}

export interface OnboardingState {
  phase: 'idle' | 'running' | 'complete';
  startedAt?: number;
  userId?: string;
  context: ContextGraph;
  signals: Signals;
  answers: Record<string, string[]>;
  preselected: Record<string, string[]>;
  /** Decision-model probability per intent option, when a decisions adapter answered in time. */
  preselectScores: Record<string, Record<string, number>>;
  path: DerivedPath;
  screenIndex: number;
  connectors: Record<string, ConnectorStatus>;
  activations: Record<string, ActivationState>;
  decisions: Record<string, Record<string, string>>;
  proofs: ProofItem[];
  ledger: LedgerEntry[];
  /** Ids of screens the user has completed, with time spent. */
  history: { screenId: string; ms: number; skipped: boolean }[];
}

export type OnboardingSnapshot = Omit<OnboardingState, 'path'>;

export interface CreateOnboardingOptions {
  spec: OnboardingSpec;
  adapters: Adapters;
  /** Pre-known signals (e.g. ICP option shares computed at build time). */
  signals?: Partial<Signals>;
  flowVersion?: string;
  variant?: string;
  /** Max ms to wait for a decision model before falling back to rules. Default 1500. */
  decisionTimeoutMs?: number;
  /** Probability at which the model pre-selects an option. Default CONFIRM_THRESHOLD (0.8). */
  preselectThreshold?: number;
}

export type Listener = (state: OnboardingState) => void;

export interface ScreenView {
  screen: DerivedScreen;
  index: number;
  total: number;
  canAdvance: boolean;
  /** Why the user can't advance yet (shown as a quiet hint, never an error banner). */
  blockedBy?: string;
}

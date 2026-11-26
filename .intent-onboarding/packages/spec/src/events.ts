/**
 * Standard onboarding event schema (RULES §9.1).
 * Vendor-neutral; the PostHog adapter sends these names and properties verbatim.
 * Every metric in docs/PLAN.md §7 is computable from these events alone.
 */
export const ONBOARDING_EVENTS = {
  onboarding_started: ['flow_version', 'variant', 'entry'] as const,
  context_inferred: ['field', 'source', 'confidence'] as const,
  confirm_shown: ['fields'] as const,
  confirm_corrected: ['field', 'source'] as const,
  intent_answered: ['question', 'options', 'preselected', 'preselected_kept', 'other_text'] as const,
  screen_viewed: ['screen_id', 'kind', 'purpose', 'index'] as const,
  screen_completed: ['screen_id', 'kind', 'duration_ms', 'skipped'] as const,
  connector_started: ['connector', 'capability'] as const,
  connector_verified: ['connector', 'capability', 'duration_ms'] as const,
  connector_failed: ['connector', 'capability', 'reason'] as const,
  activation_started: ['capability', 'activation', 'ms_since_start'] as const,
  proof_rendered: ['proof_id', 'capability', 'value', 'source', 'ms_since_start'] as const,
  decision_made: ['capability', 'decision', 'option', 'default_kept'] as const,
  onboarding_completed: ['screens', 'duration_ms', 'primary', 'secondary', 'deferred'] as const,
  dashboard_first_load: ['proof_items', 'ms_since_start'] as const,
  /** Fired alongside the spec's own aha event (spec.aha.event). */
  aha_reached: ['aha_event', 'proof_id', 'ms_since_start'] as const,
  setting_changed: ['setting', 'set_by_onboarding', 'first_session'] as const,
  /** A decision-model call (pre-selection, free-text intent…): latency and whether it answered in time. */
  decision_scored: ['purpose', 'latency_ms', 'ok'] as const,
} as const;

export type OnboardingEventName = keyof typeof ONBOARDING_EVENTS;

/** Metric definitions, so dashboards and the optimize skill compute them identically. */
export const ONBOARDING_METRICS = {
  time_to_first_proof: 'median(proof_rendered.ms_since_start where source = "own"), first per user',
  time_to_aha: 'median(aha_reached.ms_since_start), first per user',
  time_to_configured: 'median(onboarding_completed.duration_ms) where no blocking field unresolved',
  aha_rate: 'users with aha_reached / users with onboarding_started',
  proof_acceptance: 'aha_reached / proof_rendered, grouped by proof_id',
  intent_match: 'connector_verified / connector_started (connectors shown are only intent-implied)',
  screen_yield: 'screens that filled a field, verified a connector or rendered proof / screens viewed',
  inference_accuracy: '1 - confirm_corrected / (confirm_shown fields)',
  preselection_accuracy: 'sum(len(preselected_kept)) / sum(len(preselected))',
  first_session_reconfiguration: 'users with setting_changed where set_by_onboarding and first_session / users completed',
} as const;

export * from './types.ts';
export { derivePath, representativeSelections, SCREEN_SECONDS, type DerivedPath, type DerivedScreen } from './path.ts';
export { lintSpec, formatLint, type LintIssue, type LintResult, type Severity } from './lint.ts';

import type { OnboardingSpec } from './types.ts';

/** Identity helper for type inference and editor autocomplete. */
export function defineSpec(spec: OnboardingSpec): OnboardingSpec {
  return spec;
}
export { ONBOARDING_EVENTS, ONBOARDING_METRICS, type OnboardingEventName } from './events.ts';

export { replay, type Persona, type ActivationFixture, type ReplayOptions, type ReplayTrace, type TimedEvent } from './replay.ts';
export { checkDoctrine, summarize, type DoctrineViolation } from './assertions.ts';

import type { OnboardingSpec } from '../../spec/src/index.ts';
import type { ActivationFixture, Persona } from './replay.ts';

/** A template's or product's replay suite: personas plus activation fixtures. */
export interface PersonaSuite {
  spec: OnboardingSpec;
  personas: Persona[];
  activations: Record<string, ActivationFixture>;
}

export function definePersonas(suite: PersonaSuite): PersonaSuite {
  return suite;
}
export { mockDecisions } from './decisions.ts';

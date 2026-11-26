export { posthogAdapter, variantFromFlag, type PostHogAdapterOptions } from './posthog.ts';
export { computeMetrics, type OnboardingMetrics, type RawEvent, type ScreenStat } from './metrics.ts';
export { generateInsights, renderInsights, DEFAULT_TARGETS, type Recommendation, type Targets } from './insights.ts';
export { fromPostHog, fromJsonl, toJsonl, type PostHogSourceOptions } from './sources.ts';
export { synthesizeEvents, type SyntheticProblems, type SynthesizeOptions } from './synthesize.ts';

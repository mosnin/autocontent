#!/usr/bin/env -S npx tsx
/**
 * intent-onboarding insights: turn real onboarding data into ranked, approvable changes.
 *
 *   # From PostHog (POSTHOG_HOST, POSTHOG_PROJECT_ID, POSTHOG_API_KEY in env)
 *   npx tsx packages/analytics/src/cli.ts --spec onboarding/spec.ts --days 14 --out onboarding/INSIGHTS.md
 *
 *   # From a JSONL export
 *   npx tsx packages/analytics/src/cli.ts --spec onboarding/spec.ts --events events.jsonl
 *
 *   # Preview with synthetic data from a persona suite (no traffic needed)
 *   npx tsx packages/analytics/src/cli.ts --personas templates/followup-agent/personas.ts --synthetic 400
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OnboardingSpec } from '../../spec/src/index.ts';
import { computeMetrics, fromJsonl, fromPostHog, generateInsights, renderInsights, synthesizeEvents, toJsonl, type RawEvent } from './index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const load = async (p: string) => import(pathToFileURL(resolve(p)).href);

let spec: OnboardingSpec | undefined;
let events: RawEvent[];
let range: string;

if (flag('personas')) {
  const mod = await load(flag('personas')!);
  spec = mod.default.spec;
  const users = Number(flag('synthetic') ?? 300);
  const problems = flag('problems') ? JSON.parse(flag('problems')!) : mod.syntheticProblems;
  events = await synthesizeEvents(mod.default, { users, seed: Number(flag('seed') ?? 7), fieldMap: mod.fieldMap, problems });
  range = `Synthetic data (${users} simulated users from ${flag('personas')})`;
  if (flag('dump')) writeFileSync(flag('dump')!, toJsonl(events));
} else {
  if (!flag('spec')) {
    console.error('usage: --spec <spec.ts> [--events file.jsonl | PostHog env] [--days 14] [--out INSIGHTS.md]\n   or: --personas <personas.ts> --synthetic <n>');
    process.exit(2);
  }
  spec = (await load(flag('spec')!)).default;
  if (flag('events')) {
    events = fromJsonl(flag('events')!);
    range = `Export ${flag('events')}`;
  } else {
    const { POSTHOG_HOST, POSTHOG_PROJECT_ID, POSTHOG_API_KEY } = process.env;
    if (!POSTHOG_HOST || !POSTHOG_PROJECT_ID || !POSTHOG_API_KEY) {
      console.error('Set POSTHOG_HOST, POSTHOG_PROJECT_ID and POSTHOG_API_KEY (a personal API key with query:read), or pass --events.');
      process.exit(2);
    }
    const days = Number(flag('days') ?? 14);
    events = await fromPostHog({ host: POSTHOG_HOST, projectId: POSTHOG_PROJECT_ID, apiKey: POSTHOG_API_KEY, days, extraEvents: [spec!.aha.event] });
    range = `Last ${days} days (PostHog project ${POSTHOG_PROJECT_ID})`;
  }
}

const metrics = computeMetrics(events);
const recs = generateInsights(spec!, metrics);
const md = renderInsights(spec!, metrics, recs, { range });
const out = flag('out');
if (out) {
  writeFileSync(out, md);
  console.log(`✓ ${recs.length} recommendation(s) from ${metrics.users} users → ${out}`);
} else {
  console.log(md);
}

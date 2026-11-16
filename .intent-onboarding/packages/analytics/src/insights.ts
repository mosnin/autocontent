import { SCREEN_SECONDS, type OnboardingSpec, type ScreenKind } from '../../spec/src/index.ts';
import type { OnboardingMetrics } from './metrics.ts';

export interface Recommendation {
  id: string;
  title: string;
  /** Numbers that justify it. */
  evidence: string[];
  /** The metric it should move. */
  metric: string;
  /** RULES.md rule it relates to. */
  rule: string;
  /** Expected impact 1–5, confidence 0–1, effort 1–5 (lower is easier). */
  impact: number;
  confidence: number;
  effort: number;
  /** The exact spec change to make (human-approved, then shipped behind a flag). */
  specChange: string;
  experiment: string;
  score: number;
}

export interface Targets {
  timeToFirstProof: number;
  timeToAha: number;
  ahaRate: number;
  maxScreenDropOff: number;
  maxCorrectionRate: number;
  minPreselectionAccuracy: number;
  maxReconfiguration: number;
  maxConnectorFailure: number;
  minProofAcceptance: number;
}

export const DEFAULT_TARGETS: Targets = {
  timeToFirstProof: 90,
  timeToAha: 180,
  ahaRate: 0.6,
  maxScreenDropOff: 0.15,
  maxCorrectionRate: 0.2,
  minPreselectionAccuracy: 0.7,
  maxReconfiguration: 0.05,
  maxConnectorFailure: 0.1,
  minProofAcceptance: 0.4,
};

const GUARDRAIL = 'guardrails: aha rate and first-session reconfiguration must not get worse (RULES §9.2)';
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const s = (x: number) => `${x.toFixed(1)}s`;

/**
 * Turn metrics into ranked, specific recommendations. Each one has evidence, a target metric,
 * a rule, an exact spec change and an experiment. Recommendations never apply themselves.
 */
export function generateInsights(spec: OnboardingSpec, m: OnboardingMetrics, targets: Targets = DEFAULT_TARGETS, minSample = 30): Recommendation[] {
  const recs: Omit<Recommendation, 'score'>[] = [];
  const small = m.users < minSample;
  const conf = (base: number, n: number) => Math.max(0.2, Math.min(0.95, base * Math.min(1, n / Math.max(minSample, 1))));

  // 1. Time sinks: screens far slower than the spec estimates, weighted by traffic.
  for (const sc of m.screens) {
    const expected = SCREEN_SECONDS[sc.kind as ScreenKind] ?? 10;
    if (sc.completed < 5 || !(sc.medianSeconds > expected * 1.5)) continue;
    const over = sc.medianSeconds - expected;
    const byKind: Record<string, { title: string; change: string; rule: string }> = {
      confirm: { title: `Cut "${sc.screenId}" from ${s(sc.medianSeconds)}: infer more, confirm less`, change: 'For fields corrected or typed most on confirm, add inference sources (website scan, connector) or move them to askInContext on the rehearsal; keep only blocking fields on confirm.', rule: 'R3.3' },
      intent: { title: `Pre-select more on "${sc.screenId}" (${s(sc.medianSeconds)} median)`, change: `Add preselectWhen signals to the most-chosen options of "${sc.screenId.replace('intent:', '')}" (website detects, oauth provider, ICP share), and drop options under 5% usage.`, rule: 'R2.2' },
      connect: { title: `Reduce connect friction on "${sc.screenId}" (${s(sc.medianSeconds)} median)`, change: 'Request only scopes activation needs now; move write scopes to the first outbound action; prefetch the OAuth URL on screen entry.', rule: 'R6.3' },
      rehearsal: { title: `Shorten the rehearsal "${sc.screenId}" (${s(sc.medianSeconds)} median)`, change: 'Cut to the 1–2 decisions users actually change (see decision_made.default_kept); default the rest and defer them to the dashboard.', rule: 'R5.2' },
    };
    const k = byKind[sc.kind] ?? { title: `Speed up "${sc.screenId}" (${s(sc.medianSeconds)} median)`, change: 'Review whether this screen is needed; defer or merge it.', rule: 'R6.1' };
    recs.push({
      id: `time-sink:${sc.screenId}`,
      title: k.title,
      evidence: [`median ${s(sc.medianSeconds)} vs ~${expected}s expected (p75 ${s(sc.p75Seconds)})`, `${sc.completed} users, ~${s(over * sc.completed / Math.max(m.users, 1))} lost per user`],
      metric: 'time_to_first_proof',
      rule: k.rule,
      impact: Math.min(5, 1 + Math.round(over / 6)),
      confidence: conf(0.8, sc.completed),
      effort: sc.kind === 'connect' ? 3 : 2,
      specChange: k.change,
      experiment: `Ship behind flag "onboarding-flow" as variant "${sc.kind}-faster"; success = median time on ${sc.screenId} down 30% with no rise in drop-off; ${GUARDRAIL}.`,
    });
  }

  // 2. Drop-off.
  for (const sc of m.screens) {
    if (sc.viewed < 10 || sc.dropOff <= targets.maxScreenDropOff) continue;
    recs.push({
      id: `drop-off:${sc.screenId}`,
      title: `${pct(sc.dropOff)} of users stop on "${sc.screenId}"`,
      evidence: [`${sc.viewed} saw it, ${sc.completed} got past it (target ≤ ${pct(targets.maxScreenDropOff)} drop-off per screen)`],
      metric: 'aha_rate',
      rule: sc.kind === 'connect' ? 'R7.4' : 'R6.1',
      impact: Math.min(5, 2 + Math.round(sc.dropOff * 10)),
      confidence: conf(0.85, sc.viewed),
      effort: 2,
      specChange: sc.kind === 'connect'
        ? 'Add a proof.fallback (public or labeled sample data) to this capability so users who can\'t connect still reach proof, and show "Continue without" after one failed attempt.'
        : 'Watch session replays for this screen, then remove the field or decision users stall on, or move it after the aha.',
      experiment: `Variant "${sc.screenId}-fix" vs control; success = drop-off on ${sc.screenId} under ${pct(targets.maxScreenDropOff)}; ${GUARDRAIL}.`,
    });
  }

  // 3. Time to first proof over budget → look at activation latency.
  if (m.timeToFirstProof.n && m.timeToFirstProof.median > targets.timeToFirstProof) {
    const slowest = Object.entries(m.activationLatency).sort((a, b) => b[1].median - a[1].median)[0];
    recs.push({
      id: 'ttfp-over-budget',
      title: `Time to first proof is ${s(m.timeToFirstProof.median)} (target ${targets.timeToFirstProof}s)`,
      evidence: [`median ${s(m.timeToFirstProof.median)}, p75 ${s(m.timeToFirstProof.p75)}`, slowest ? `slowest activation: ${slowest[0]} at ${s(slowest[1].median)} from verify to proof` : 'no activation latency data'],
      metric: 'time_to_first_proof',
      rule: 'R6.1',
      impact: 5,
      confidence: conf(0.9, m.timeToFirstProof.n),
      effort: 3,
      specChange: slowest
        ? `Make ${slowest[0]} emit its first countable result early (stream partial counts, cap the first scan to the last 14 days), then lower activation.estSecondsToFirstResult to match.`
        : 'Instrument activation_started and proof_rendered so latency can be attributed.',
      experiment: `Variant "fast-first-result"; success = median TTFP ≤ ${targets.timeToFirstProof}s; ${GUARDRAIL}.`,
    });
  }

  // 4. Proof acceptance.
  const proofs = Object.entries(m.proofAcceptance).filter(([, p]) => p.shown >= 10);
  const best = proofs.sort((a, b) => b[1].rate - a[1].rate)[0];
  for (const [id, p] of proofs) {
    if (p.rate >= targets.minProofAcceptance) continue;
    const cap = spec.capabilities.find((c) => c.proof.id === id);
    recs.push({
      id: `proof:${id}`,
      title: `Proof "${id}" convinces only ${pct(p.rate)} of users`,
      evidence: [`${p.acted}/${p.shown} acted on it`, best && best[0] !== id ? `best proof "${best[0]}" converts ${pct(best[1].rate)}` : 'no stronger proof to compare'],
      metric: 'proof_acceptance',
      rule: 'R5.1',
      impact: 4,
      confidence: conf(0.8, p.shown),
      effort: 2,
      specChange: cap
        ? `Rewrite capabilities.${cap.id}.proof.statement to lead with money or time ("…worth {amount}", "…went quiet {days} days ago"), and make the CTA a single concrete action (current: "${cap.proof.statement}")`
        : `Rewrite proof "${id}" to be more specific and actionable.`,
      experiment: `A/B the statement on 50% of ${cap?.id ?? id} users; success = acceptance ≥ ${pct(targets.minProofAcceptance)}; ${GUARDRAIL}.`,
    });
  }

  // 5. Intent options that stall.
  for (const [opt, o] of Object.entries(m.intentOptions)) {
    if (o.users < 10 || o.ahaRate >= m.ahaRate * 0.6) continue;
    const option = spec.intents.flatMap((q) => q.options).find((x) => x.id === opt);
    recs.push({
      id: `intent-path:${opt}`,
      title: `Users who pick "${option?.label ?? opt}" rarely reach the aha (${pct(o.ahaRate)} vs ${pct(m.ahaRate)} overall)`,
      evidence: [`${o.aha}/${o.users} reached aha`],
      metric: 'aha_rate',
      rule: 'R2.5',
      impact: 4,
      confidence: conf(0.75, o.users),
      effort: 3,
      specChange: option?.capabilities.length
        ? `Investigate capabilities ${option.capabilities.join(', ')}: speed up activation or add a proof.fallback; if it stays weak, lower its priority so a stronger capability becomes primary.`
        : `Route "${opt}" to a capability with a proof that needs no connector (zeroSetup).`,
      experiment: `Variant "${opt}-path"; success = aha rate for this option within 80% of overall; ${GUARDRAIL}.`,
    });
  }

  // 6. Inference corrections.
  for (const [field, f] of Object.entries(m.inference)) {
    if (f.shown < 10 || f.correctionRate <= targets.maxCorrectionRate) continue;
    const def = spec.fields.find((x) => x.id === field);
    recs.push({
      id: `inference:${field}`,
      title: `"${def?.label ?? field}" is corrected ${pct(f.correctionRate)} of the time`,
      evidence: [`${f.corrected}/${f.shown} confirm cards edited (target ≤ ${pct(targets.maxCorrectionRate)})`, def ? `current sources: ${def.infer.join(', ') || 'none'}` : ''].filter(Boolean),
      metric: 'inference_accuracy',
      rule: 'R3.3',
      impact: 3,
      confidence: conf(0.85, f.shown),
      effort: 2,
      specChange: `Reorder fields.${field}.infer so the most reliable source wins (prefer connector data over email_domain), lower the domain-guess confidence below 0.8 so it is asked in context instead of pre-filled, or add askInContext where the value is visible.`,
      experiment: `Variant "${field}-inference"; success = correction rate ≤ ${pct(targets.maxCorrectionRate)} with confirm-screen time not increasing; ${GUARDRAIL}.`,
    });
  }

  // 7. Pre-selection accuracy.
  if (m.preselection.preselected >= 20 && m.preselection.accuracy < targets.minPreselectionAccuracy) {
    recs.push({
      id: 'preselection',
      title: `Pre-selections are kept only ${pct(m.preselection.accuracy)} of the time`,
      evidence: [`${m.preselection.kept}/${m.preselection.preselected} pre-selected options kept`],
      metric: 'preselection_accuracy',
      rule: 'R2.2',
      impact: 3,
      confidence: conf(0.8, m.preselection.preselected),
      effort: 2,
      specChange: 'Tighten preselectWhen: drop weak signals (generic social links, low ICP shares below 0.5) and keep strong ones (ad pixels, OAuth provider, connector facts).',
      experiment: `Variant "tighter-preselect"; success = accuracy ≥ ${pct(targets.minPreselectionAccuracy)} and intent-screen time not up; ${GUARDRAIL}.`,
    });
  }

  // 8. First-session reconfiguration hotspots.
  for (const [setting, r] of Object.entries(m.reconfiguration.bySetting)) {
    if (r <= targets.maxReconfiguration) continue;
    const decision = spec.capabilities.flatMap((c) => c.rehearsal.decisions.map((d) => ({ c, d }))).find((x) => x.d.id === setting);
    recs.push({
      id: `reconfig:${setting}`,
      title: `${pct(r)} of users change "${setting}" in their first session`,
      evidence: [`target ≤ ${pct(targets.maxReconfiguration)}: onboarding set it, and the user had to fix it`],
      metric: 'first_session_reconfiguration',
      rule: 'R1.4',
      impact: 4,
      confidence: conf(0.85, m.completed),
      effort: 2,
      specChange: decision
        ? `Change the default of ${decision.c.id}.rehearsal.decisions.${setting} to the value users switch to, and make the rehearsal example show the difference.`
        : `Move "${setting}" into the rehearsal as a decision on a real example (≤ 3 decisions per capability), or infer it.`,
      experiment: `Variant "${setting}-in-rehearsal"; success = first-session changes ≤ ${pct(targets.maxReconfiguration)}; ${GUARDRAIL}.`,
    });
  }

  // 9. Connector failures.
  for (const [c, f] of Object.entries(m.connectorFailures)) {
    if (f.started < 10 || f.rate <= targets.maxConnectorFailure) continue;
    recs.push({
      id: `connector:${c}`,
      title: `${pct(f.rate)} of ${c} connections fail`,
      evidence: [`${f.failed}/${f.started} attempts failed`],
      metric: 'intent_match',
      rule: 'R4.5',
      impact: 4,
      confidence: conf(0.85, f.started),
      effort: 3,
      specChange: `Log connector_failed.reason for ${c} and fix the top reason; offer a one-tap retry and a "Continue without" path backed by proof.fallback.`,
      experiment: `Variant "${c}-retry"; success = failure rate ≤ ${pct(targets.maxConnectorFailure)}; ${GUARDRAIL}.`,
    });
  }

  return recs
    .map((r) => ({ ...r, confidence: small ? Math.min(r.confidence, 0.4) : r.confidence, score: Math.round(((r.impact * r.confidence) / r.effort) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

/** Render onboarding/INSIGHTS.md in the format the optimize skill specifies. */
export function renderInsights(spec: OnboardingSpec, m: OnboardingMetrics, recs: Recommendation[], opts: { range?: string; targets?: Targets } = {}): string {
  const t = opts.targets ?? DEFAULT_TARGETS;
  const status = (ok: boolean) => (ok ? '✅' : '⚠️');
  const lines = [
    `# Onboarding insights: ${spec.product.name}`,
    '',
    `${opts.range ?? 'All data'} · ${m.users} users${m.users < 30 ? ' · **small sample, directional only**' : ''}`,
    '',
    '## Headline',
    '',
    '| Metric | Current | Target | |',
    '|---|---|---|---|',
    `| Time to first proof (median) | ${s(m.timeToFirstProof.median)} | ≤ ${t.timeToFirstProof}s | ${status(m.timeToFirstProof.median <= t.timeToFirstProof)} |`,
    `| Time to aha (median) | ${s(m.timeToAha.median)} | ≤ ${t.timeToAha}s | ${status(m.timeToAha.median <= t.timeToAha)} |`,
    `| Aha rate | ${pct(m.ahaRate)} | ≥ ${pct(t.ahaRate)} | ${status(m.ahaRate >= t.ahaRate)} |`,
    `| Completion | ${pct(m.completionRate)} | n/a | |`,
    `| Intent match (verified / started connects) | ${pct(m.intentMatch.rate)} | ≥ 95% | ${status(m.intentMatch.rate >= 0.95)} |`,
    `| Pre-selection accuracy | ${pct(m.preselection.accuracy)} | ≥ ${pct(t.minPreselectionAccuracy)} | ${status(m.preselection.accuracy >= t.minPreselectionAccuracy)} |`,
    `| First-session reconfiguration | ${pct(m.reconfiguration.rate)} | ≤ ${pct(t.maxReconfiguration)} | ${status(m.reconfiguration.rate <= t.maxReconfiguration)} |`,
    '',
  ];
  if (Object.keys(m.byVariant).length > 1) {
    lines.push('### By variant', '', '| Variant | Users | Aha rate | TTFP median |', '|---|---|---|---|');
    for (const [v, x] of Object.entries(m.byVariant)) lines.push(`| ${v} | ${x.users} | ${pct(x.ahaRate)} | ${s(x.timeToFirstProofMedian)} |`);
    lines.push('');
  }
  lines.push('## Recommendations', '', recs.length ? '_Ranked by expected impact × confidence ÷ effort. Each ships behind the `onboarding-flow` flag after human approval._' : 'Nothing crosses a threshold. Keep collecting data.', '');
  recs.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.title}`, '', `- **Evidence:** ${r.evidence.join('; ')}`, `- **Moves:** \`${r.metric}\` · impact ${r.impact}/5 · confidence ${pct(r.confidence)} · effort ${r.effort}/5`, `- **Rule:** ${r.rule}`, `- **Spec change:** ${r.specChange}`, `- **Experiment:** ${r.experiment}`, '');
  });
  lines.push('## Screens', '', '| Screen | Viewed | Drop-off | Median | p75 |', '|---|---|---|---|---|');
  for (const sc of m.screens) lines.push(`| ${sc.screenId} | ${sc.viewed} | ${pct(sc.dropOff)} | ${s(sc.medianSeconds)} | ${s(sc.p75Seconds)} |`);
  lines.push('', '## Proofs', '', '| Proof | Shown | Acted | Acceptance |', '|---|---|---|---|');
  for (const [id, p] of Object.entries(m.proofAcceptance)) lines.push(`| ${id} | ${p.shown} | ${p.acted} | ${pct(p.rate)} |`);
  lines.push('');
  return lines.join('\n');
}

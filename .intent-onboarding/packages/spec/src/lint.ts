import { derivePath, representativeSelections } from './path.ts';
import { DEFAULT_BUDGET, type OnboardingSpec } from './types.ts';

export type Severity = 'error' | 'warn';

export interface LintIssue {
  /** Rule id, e.g. 'R2.3', matching the section in RULES.md. */
  rule: string;
  severity: Severity;
  message: string;
  /** Where in the spec, e.g. 'capabilities.meta_ads.activation'. */
  at?: string;
}

export interface LintResult {
  ok: boolean;
  errors: LintIssue[];
  warnings: LintIssue[];
}

/**
 * Field ids/labels that signal a generic signup form. Allowed only as `deferrable`
 * (or inferred-only), never as something the user types before the dashboard.
 */
const GENERIC_FORM_PATTERNS: RegExp[] = [
  /how.?did.?you.?hear/i,
  /referr?al.?source|attribution|heard.?about/i,
  /\bbio\b/i,
  /company.?size|team.?size|employees/i,
  /job.?title|\brole\b/i,
  /phone/i,
  /industry/i,
  /birthday|date.?of.?birth/i,
];

const NAME_LIKE = /(^|_)(first|last|full)?_?name$|^name$|display.?name/i;

export function lintSpec(spec: OnboardingSpec): LintResult {
  const issues: LintIssue[] = [];
  const add = (rule: string, severity: Severity, message: string, at?: string) => issues.push({ rule, severity, message, at });

  const capIds = new Set(spec.capabilities.map((c) => c.id));
  const connIds = new Set(spec.connectors.map((c) => c.id));
  const fieldIds = new Set(spec.fields.map((f) => f.id));

  // ── Aha first ────────────────────────────────────────────────────────────
  if (!spec.aha?.statement?.trim()) add('R1.1', 'error', 'Spec has no aha statement. Write the aha before anything else.', 'aha');
  const ctaEvents = new Set(spec.capabilities.map((c) => c.proof.cta.event));
  if (spec.aha?.event && !ctaEvents.has(spec.aha.event)) {
    add('R5.3', 'error', `aha.event "${spec.aha.event}" is not the CTA event of any proof. The aha must be the user acting on a proof.`, 'aha.event');
  }

  // ── Intent first ─────────────────────────────────────────────────────────
  if (spec.intents.length === 0) add('R2.1', 'error', 'Spec has no intent questions. Onboarding must be driven by what the user is trying to do.', 'intents');
  const first = spec.intents[0];
  if (first && first.about === 'product') {
    add('R2.1', 'error', `First intent question "${first.id}" is about the product. Ask about the user's goal or workflow first.`, `intents.${first.id}`);
  }
  for (const q of spec.intents) {
    const at = `intents.${q.id}`;
    for (const o of q.options) if (o.none && o.preselectWhen?.length) add('R2.5', 'error', `"${o.id}" is the none option and can't be pre-selected.`, `${at}.${o.id}`);
    if (q.options.length < 2) add('R2.2', 'error', `Intent "${q.id}" must be multiple choice with at least 2 options.`, at);
    if (q.options.length > 9) add('R2.2', 'warn', `Intent "${q.id}" has ${q.options.length} options. Keep it to 9 or fewer so number keys work and choice stays fast.`, at);
    for (const o of q.options) {
      for (const c of o.capabilities) if (!capIds.has(c)) add('R2.3', 'error', `Option "${o.id}" selects unknown capability "${c}".`, `${at}.${o.id}`);
    }
    for (const c of q.askWhen ?? []) if (!capIds.has(c)) add('R2.3', 'error', `askWhen references unknown capability "${c}".`, at);
    if (q.fills && !fieldIds.has(q.fills)) add('R3.1', 'error', `Intent "${q.id}" fills unknown field "${q.fills}".`, at);
    if (!q.fills && q.options.every((o) => o.capabilities.length === 0)) {
      add('R1.3', 'error', `Intent "${q.id}" neither selects a capability nor fills a field, so the answer changes nothing.`, at);
    }
    if (q.fills) {
      const f = spec.fields.find((x) => x.id === q.fills);
      if (f?.tier === 'deferrable' || f?.category === 'marketing') add('R3.6', 'error', `Intent "${q.id}" asks for "${q.fills}", a deferrable/marketing field, before the dashboard.`, at);
    }
  }
  const hasPreselect = spec.intents.some((q) => q.options.some((o) => (o.preselectWhen?.length ?? 0) > 0));
  if (!hasPreselect) add('R2.2', 'warn', 'No intent option declares preselectWhen. Pre-select from enrichment or ICP data so most users only confirm.', 'intents');

  const workflowQs = spec.intents.filter((q) => q.about === 'workflow');
  if (workflowQs.length > 0 && !workflowQs.some((q) => q.options.some((o) => o.none || o.capabilities.length === 0 || o.capabilities.some((c) => spec.capabilities.find((x) => x.id === c)?.zeroSetup)))) {
    add('R2.5', 'warn', 'No "not yet / I don\'t do this today" path. Add an option that routes to a zeroSetup capability.', 'intents');
  }

  // ── Reachability: connectors only through intent ─────────────────────────
  const reachableCaps = new Set(spec.intents.flatMap((q) => q.options.flatMap((o) => o.capabilities)));
  for (const c of spec.capabilities) {
    if (!reachableCaps.has(c.id)) add('R2.3', 'error', `Capability "${c.id}" is not selected by any intent option, so it can only appear as an unrequested screen.`, `capabilities.${c.id}`);
    for (const cid of c.connectors) if (!connIds.has(cid)) add('R2.3', 'error', `Capability "${c.id}" needs unknown connector "${cid}".`, `capabilities.${c.id}`);
    for (const fid of c.fields) if (!fieldIds.has(fid)) add('R3.1', 'error', `Capability "${c.id}" needs unknown field "${fid}".`, `capabilities.${c.id}`);
  }
  const usedConnectors = new Set(spec.capabilities.flatMap((c) => c.connectors));
  for (const conn of spec.connectors) {
    if (!usedConnectors.has(conn.id)) add('R2.3', 'error', `Connector "${conn.id}" isn't used by any capability. Connectors may only appear through intent.`, `connectors.${conn.id}`);
  }

  // ── Fields ───────────────────────────────────────────────────────────────
  for (const f of spec.fields) {
    const at = `fields.${f.id}`;
    const looksGeneric = GENERIC_FORM_PATTERNS.some((p) => p.test(f.id) || p.test(f.label));
    if (f.category === 'marketing' && f.tier !== 'deferrable') {
      add('R3.6', 'error', `Marketing field "${f.id}" must be deferrable. Infer it (utm/enrichment) or ask after the aha.`, at);
    }
    if (f.category === 'marketing' && f.askInContext) {
      add('R3.6', 'error', `Marketing field "${f.id}" is asked during onboarding (askInContext). Remove it; infer from utm or ask after the aha.`, at);
    }
    if (looksGeneric && f.tier !== 'deferrable' && f.infer.length === 0) {
      add('R3.3', 'error', `"${f.id}" looks like a generic signup-form field and has no inference source. Infer it, or make it deferrable.`, at);
    } else if (looksGeneric && f.tier !== 'deferrable') {
      add('R3.2', 'warn', `"${f.id}" looks like a generic signup-form field. Confirm it really changes setup; otherwise make it deferrable.`, at);
    }
    if (f.tier === 'deferrable' && f.askInContext && !(f.blockingWhen?.length)) {
      add('R3.2', 'error', `Deferrable field "${f.id}" is asked during onboarding. Defer it, or declare blockingWhen for the capability that needs it.`, at);
    }
    if (f.tier !== 'deferrable' && f.infer.length === 0 && !f.askInContext) {
      add('R3.3', 'error', `Required field "${f.id}" has no inference source and no in-context ask, so it can't be resolved.`, at);
    }
    if (f.askInContext && !f.askInContext.surface.trim()) {
      add('R3.4', 'error', `Field "${f.id}" is asked without a surface. Ask where it visibly matters (e.g. 'signature preview').`, at);
    }
    if (NAME_LIKE.test(f.id) && !f.infer.includes('oauth_profile')) {
      add('R3.3', 'warn', `Name field "${f.id}" doesn't infer from oauth_profile. Sign-in already provides it.`, at);
    }
    for (const c of f.blockingWhen ?? []) if (!capIds.has(c)) add('R3.2', 'error', `blockingWhen references unknown capability "${c}".`, at);
  }

  // ── Activation, proof, rehearsal ─────────────────────────────────────────
  for (const c of spec.capabilities) {
    const at = `capabilities.${c.id}`;
    if (!c.activation?.description?.trim()) add('R4.1', 'error', `Capability "${c.id}" has no activation. It must start working the moment its connector verifies.`, `${at}.activation`);
    if (!c.proof?.statement?.trim()) add('R4.1', 'error', `Capability "${c.id}" has no proof statement.`, `${at}.proof`);
    if (c.proof && !/\{[a-z_]+\}/i.test(c.proof.statement)) {
      add('R5.1', 'warn', `Proof "${c.proof.id}" has no {placeholder}. Proof should be about the user's own data ("I found {count} …").`, `${at}.proof`);
    }
    if (c.proof?.fallback?.source === 'sample' && !c.proof.fallback.labeled) {
      add('R5.1', 'error', `Proof "${c.proof.id}" falls back to sample data without labeling it.`, `${at}.proof.fallback`);
    }
    const gate = c.rehearsal?.decisions.some((d) => d.gatesOutbound);
    if (c.activation?.access === 'write' && !gate) {
      add('R4.4', 'error', `Activation "${c.activation.id}" writes or sends, but no rehearsal decision gatesOutbound.`, `${at}.activation`);
    }
    const writesScopes = c.connectors.some((cid) => spec.connectors.find((x) => x.id === cid)?.scopes.some((s) => s.access === 'write'));
    if (writesScopes && !gate) {
      add('R4.4', 'warn', `"${c.id}" requests write scopes but no decision gates outbound actions.`, at);
    }
    if (!c.rehearsal) add('R5.2', 'error', `Capability "${c.id}" has no rehearsal. Core decisions must be made on a real example.`, at);
    else {
      if (c.rehearsal.decisions.length === 0) add('R5.2', 'warn', `Rehearsal for "${c.id}" has no decisions. What does the user configure?`, `${at}.rehearsal`);
      if (c.rehearsal.decisions.length > 3) add('R5.2', 'error', `Rehearsal for "${c.id}" has ${c.rehearsal.decisions.length} decisions (max 3). Defer the rest.`, `${at}.rehearsal`);
      for (const d of c.rehearsal.decisions) {
        if (!d.options.some((o) => o.id === d.default)) add('R5.2', 'error', `Decision "${d.id}" default "${d.default}" is not one of its options.`, `${at}.rehearsal.${d.id}`);
      }
    }
  }
  if (!spec.capabilities.some((c) => c.zeroSetup || c.proof.fallback)) {
    add('R5.1', 'warn', 'No capability has a fallback proof or is zeroSetup. Users who can\'t connect will reach the dashboard with nothing.', 'capabilities');
  }

  // ── Trust ────────────────────────────────────────────────────────────────
  for (const conn of spec.connectors) {
    if (conn.auth !== 'none' && conn.scopes.length === 0) add('R7.1', 'error', `Connector "${conn.id}" declares no scopes to show the user.`, `connectors.${conn.id}`);
    for (const s of conn.scopes) if (s.description.trim().length < 8) add('R7.1', 'error', `Scope "${s.id}" on "${conn.id}" needs a plain-language description.`, `connectors.${conn.id}`);
    if (!conn.verify?.trim()) add('R4.5', 'error', `Connector "${conn.id}" has no verify call. "Connected" means the first authenticated call succeeded.`, `connectors.${conn.id}`);
  }

  // ── Custom screens ───────────────────────────────────────────────────────
  for (const s of spec.customScreens ?? []) {
    if (!['gather', 'setup', 'prove'].includes(s.purpose)) add('R1.3', 'error', `Custom screen "${s.id}" has no valid purpose.`, `customScreens.${s.id}`);
    if (s.purpose === 'gather' && !(s.fills?.length)) add('R1.3', 'error', `Custom gather screen "${s.id}" fills no fields, so it changes nothing.`, `customScreens.${s.id}`);
    for (const fid of s.fills ?? []) {
      const f = spec.fields.find((x) => x.id === fid);
      if (f?.tier === 'deferrable') add('R3.2', 'error', `Custom screen "${s.id}" asks deferrable field "${fid}".`, `customScreens.${s.id}`);
    }
  }

  // ── Budget ───────────────────────────────────────────────────────────────
  const b = spec.budget;
  const looser = b.maxScreens > DEFAULT_BUDGET.maxScreens || b.maxSeconds > DEFAULT_BUDGET.maxSeconds || b.maxSecondsToProof > DEFAULT_BUDGET.maxSecondsToProof;
  if (looser && !b.justification?.trim()) add('R6.1', 'error', 'Budget is looser than the defaults (6 screens / 120s / 90s to proof) without a justification.', 'budget');

  for (const sel of representativeSelections(spec)) {
    const p = derivePath(spec, sel.options);
    const at = `path[${sel.label}]`;
    if (p.selectedCapabilities.length === 0) continue; // a pure "not yet" path is checked by R2.5
    if (p.screenCount > b.maxScreens) add('R6.1', 'error', `${p.screenCount} screens before the dashboard (max ${b.maxScreens}).`, at);
    if (p.totalSeconds > b.maxSeconds) add('R6.1', 'error', `~${p.totalSeconds}s to the dashboard (max ${b.maxSeconds}s).`, at);
    if (p.secondsToProof > b.maxSecondsToProof) add('R6.1', 'error', `~${p.secondsToProof}s to first proof (max ${b.maxSecondsToProof}s).`, at);
    for (const f of p.unresolvedFields) add('R3.3', 'error', `Field "${f}" is required on this path but can't be inferred or asked.`, at);
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warn');
  return { ok: errors.length === 0, errors, warnings };
}

export function formatLint(name: string, r: LintResult): string {
  const lines = [`${r.ok ? '✓' : '✗'} ${name}: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`];
  for (const i of [...r.errors, ...r.warnings]) {
    lines.push(`  ${i.severity === 'error' ? 'error' : 'warn '} ${i.rule.padEnd(5)} ${i.message}${i.at ? `  (${i.at})` : ''}`);
  }
  return lines.join('\n');
}

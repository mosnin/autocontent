#!/usr/bin/env -S npx tsx
/**
 * Lint onboarding specs against RULES.md and print the derived path for each.
 *
 *   npx tsx packages/spec/src/cli.ts templates/*\/spec.ts
 *   npx tsx packages/spec/src/cli.ts onboarding/spec.ts --paths
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { derivePath, representativeSelections } from './path.ts';
import { formatLint, lintSpec } from './lint.ts';
import type { OnboardingSpec } from './types.ts';

const args = process.argv.slice(2);
const showPaths = args.includes('--paths');
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: intent-onboarding-lint <spec.ts...> [--paths]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const spec: OnboardingSpec | undefined = mod.default ?? mod.spec;
  if (!spec) {
    console.error(`✗ ${file}: no default export (export default defineSpec({...}))`);
    failed = true;
    continue;
  }
  const result = lintSpec(spec);
  console.log(formatLint(file, result));
  if (showPaths) {
    for (const sel of representativeSelections(spec)) {
      const p = derivePath(spec, sel.options);
      const proof = Number.isFinite(p.secondsToProof) ? `${p.secondsToProof}s` : 'none';
      console.log(`    path ${sel.label}: ${p.screens.map((s) => s.id).join(' → ')}  [${p.screenCount} screens, ~${p.totalSeconds}s, proof ${proof}]`);
    }
  }
  if (!result.ok) failed = true;
}
process.exit(failed ? 1 : 0);

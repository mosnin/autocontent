#!/usr/bin/env -S npx tsx
/**
 * Replay persona suites through the real engine and check the doctrine.
 *
 *   npx tsx packages/testing/src/cli.ts templates/*\/personas.ts
 *
 * A personas module default-exports definePersonas({ spec, personas, activations }) and may
 * export `fieldMap` for the built-in enrichers.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDoctrine, replay, summarize, type PersonaSuite } from './index.ts';

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length === 0) {
  console.error('usage: intent-onboarding-replay <personas.ts...>');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const mod = await import(pathToFileURL(resolve(file)).href);
  const suite: PersonaSuite = mod.default;
  console.log(`\n${file}`);
  for (const persona of suite.personas) {
    const trace = await replay(suite.spec, persona, { activations: suite.activations, fieldMap: mod.fieldMap });
    const violations = checkDoctrine(suite.spec, trace);
    console.log(`  ${violations.length ? '✗' : '✓'} ${summarize(trace)}`);
    for (const v of violations) console.log(`      ${v.rule.padEnd(5)} ${v.message}`);
    if (violations.length) failed = true;
  }
}
process.exit(failed ? 1 : 0);

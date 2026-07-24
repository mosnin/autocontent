/**
 * Verifies the marketer.sh Studio model catalog.
 *
 * Asserts, per array, that the exact model count matches what was ported, that
 * every entry is structurally sound, and that a few named models still resolve
 * through their selectors with their enums intact. Exits non-zero on mismatch.
 *
 * Run: node --experimental-strip-types web/scripts/verify-catalog.mjs
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The catalog is TypeScript with extensionless relative imports (our app
// convention). Node's resolver needs the extension, so append it here.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL) {
      const resolved = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(resolved + '.ts'))) {
        return nextResolve(specifier + '.ts', context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const studio = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../lib/studio');

const catalog = await import(path.join(studio, 'model-catalog.ts'));
const selectors = await import(path.join(studio, 'model-selectors.ts'));

/** Exact model counts, taken from the source catalog at port time. */
const EXPECTED_COUNTS = {
  t2iModels: 70,
  t2vModels: 87,
  i2iModels: 72,
  i2vModels: 123,
  v2vModels: 36,
  lipsyncModels: 15,
  recastModels: 3,
  audioModels: 16,
};

const failures = [];
const fail = (msg) => failures.push(msg);

// ── Per-array counts and structural soundness ────────────────────────────────
let total = 0;
const seenIds = new Map();

for (const [name, expected] of Object.entries(EXPECTED_COUNTS)) {
  const arr = catalog[name];
  if (!Array.isArray(arr)) {
    fail(`${name}: not exported as an array`);
    continue;
  }
  if (arr.length !== expected) {
    fail(`${name}: expected ${expected} models, got ${arr.length}`);
  }
  total += arr.length;

  const ids = new Set();
  arr.forEach((m, i) => {
    if (!m || typeof m !== 'object') return fail(`${name}[${i}]: not an object`);
    if (typeof m.id !== 'string' || !m.id) fail(`${name}[${i}]: missing id`);
    if (typeof m.name !== 'string' || !m.name) fail(`${name}[${m.id}]: missing name`);
    if (m.inputs !== undefined && (typeof m.inputs !== 'object' || m.inputs === null)) {
      fail(`${name}[${m.id}]: inputs is not an object`);
    }
    if (ids.has(m.id)) fail(`${name}: duplicate id "${m.id}"`);
    ids.add(m.id);
  });
  seenIds.set(name, ids);

  console.log(`  ${name.padEnd(14)} ${String(arr.length).padStart(3)} models`);
}
console.log(`  ${'total'.padEnd(14)} ${String(total).padStart(3)} models`);

// ── Derived arrays ────────────────────────────────────────────────────────────
const derived = catalog.imageLipSyncModels.length + catalog.videoLipSyncModels.length;
if (derived !== catalog.lipsyncModels.length) {
  fail(
    `lip-sync split: image(${catalog.imageLipSyncModels.length}) + video(${catalog.videoLipSyncModels.length}) !== ${catalog.lipsyncModels.length}`,
  );
}
if (catalog.allModels.length !== total) {
  fail(`allModels: expected ${total}, got ${catalog.allModels.length}`);
}

// ── Named models resolve through their selectors with enums intact ───────────
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const namedChecks = [
  {
    label: 'nano-banana (t2i)',
    run: () => {
      const m = selectors.getModelById('nano-banana');
      if (!m) return 'does not resolve via getModelById';
      if (m.provider !== 'google') return `provider is "${m.provider}", expected "google"`;
      const ar = selectors.getAspectRatiosForModel('nano-banana');
      const expected = ['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3', '5:4', '4:5', '21:9'];
      if (!eq(ar, expected)) return `aspect ratios are ${JSON.stringify(ar)}`;
      if (!eq(ar, m.inputs.aspect_ratio.enum)) return 'selector enum diverges from schema enum';
      return null;
    },
  },
  {
    label: 'flux-dev (t2i)',
    run: () => {
      const m = selectors.getModelById('flux-dev');
      if (!m) return 'does not resolve via getModelById';
      const w = m.inputs?.width;
      if (!w) return 'missing width input';
      if (w.minValue !== 128 || w.default !== 1024) {
        return `width bounds/default unexpected: ${JSON.stringify(w)}`;
      }
      if (!m.inputs?.prompt?.examples?.length) return 'prompt examples missing';
      return null;
    },
  },
  {
    // "Seedance 2.0" ships as several endpoint-specific entries; this is the
    // text-to-video one.
    label: 'seedance-v2.0-t2v / "Seedance 2.0" (t2v)',
    run: () => {
      const id = 'seedance-v2.0-t2v';
      const m = selectors.getVideoModelById(id);
      if (!m) return 'does not resolve via getVideoModelById';
      if (m.name !== 'Seedance 2.0') return `name is "${m.name}"`;
      if (m.provider !== 'bytedance') return `provider is "${m.provider}"`;
      if (!eq(selectors.getAspectRatiosForVideoModel(id), ['16:9', '9:16', '4:3', '3:4'])) {
        return `aspect ratios are ${JSON.stringify(selectors.getAspectRatiosForVideoModel(id))}`;
      }
      if (!eq(selectors.getDurationsForModel(id), [5, 10, 15])) {
        return `durations are ${JSON.stringify(selectors.getDurationsForModel(id))}`;
      }
      // Quality-only model: no `resolution` input, so resolutions are empty.
      if (!eq(selectors.getResolutionsForVideoModel(id), [])) return 'unexpected resolutions';
      if (!eq(m.inputs.quality.enum, ['high', 'basic'])) return 'quality enum diverged';
      return null;
    },
  },
  {
    // Image + audio -> talking video, so it lives in the lip-sync catalog.
    label: 'infinitetalk-image-to-video (lip-sync)',
    run: () => {
      const id = 'infinitetalk-image-to-video';
      const m = selectors.getLipSyncModelById(id);
      if (!m) return 'does not resolve via getLipSyncModelById';
      if (m.category !== 'image') return `category is "${m.category}", expected "image"`;
      if (!catalog.imageLipSyncModels.some((x) => x.id === id)) {
        return 'missing from imageLipSyncModels';
      }
      if (!eq(selectors.getResolutionsForLipSyncModel(id), ['480p', '720p'])) {
        return `resolutions are ${JSON.stringify(selectors.getResolutionsForLipSyncModel(id))}`;
      }
      return null;
    },
  },
];

for (const { label, run } of namedChecks) {
  let problem;
  try {
    problem = run();
  } catch (err) {
    problem = `threw: ${err.message}`;
  }
  if (problem) fail(`${label}: ${problem}`);
  else console.log(`  ok  ${label}`);
}

// ── Selector fallbacks for unknown ids ───────────────────────────────────────
const fallbacks = [
  ['getAspectRatiosForModel', ['1:1']],
  ['getAspectRatiosForVideoModel', ['16:9']],
  ['getAspectRatiosForI2IModel', ['1:1']],
  ['getAspectRatiosForI2VModel', ['16:9']],
  ['getDurationsForModel', [5]],
  ['getDurationsForI2VModel', []],
  ['getResolutionsForModel', []],
  ['getResolutionsForI2VModel', []],
  ['getEffectsForI2IModel', []],
  ['getModesForModel', []],
];
for (const [fn, expected] of fallbacks) {
  const got = selectors[fn]('__no_such_model__');
  if (!eq(got, expected)) fail(`${fn}(unknown): expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
}
if (selectors.getMaxImagesForI2IModel('__no_such_model__') !== 1) {
  fail('getMaxImagesForI2IModel(unknown): expected 1');
}
if (selectors.getQualityFieldForModel('__no_such_model__') !== null) {
  fail('getQualityFieldForModel(unknown): expected null');
}

// ── Every selector is exported ───────────────────────────────────────────────
const REQUIRED_SELECTORS = [
  'getModelById', 'getVideoModelById', 'getI2IModelById', 'getI2VModelById',
  'getV2VModelById', 'getRecastModelById', 'getLipSyncModelById', 'getAudioModelById',
  'getAspectRatiosForModel', 'getAspectRatiosForVideoModel', 'getAspectRatiosForI2IModel',
  'getAspectRatiosForI2VModel', 'getAspectRatiosForRecastModel',
  'getDurationsForModel', 'getDurationsForI2VModel',
  'getResolutionsForModel', 'getResolutionsForVideoModel', 'getResolutionsForI2IModel',
  'getResolutionsForI2VModel', 'getResolutionsForLipSyncModel',
  'getQualityFieldForModel', 'getQualityFieldForI2IModel',
  'getMaxImagesForI2IModel', 'getMaxImagesForI2VModel',
  'getEffectsForI2IModel', 'getEffectsForI2VModel',
  'getDefaultEffectForI2IModel', 'getDefaultEffectForI2VModel',
  'getModesForModel',
];
for (const fn of REQUIRED_SELECTORS) {
  if (typeof selectors[fn] !== 'function') fail(`selector "${fn}" is not exported`);
}

// ── Result ────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nPASS — ${total} models, ${REQUIRED_SELECTORS.length} selectors verified.`);

/**
 * marketer.sh Studio model catalog.
 *
 * Single entry point for every model array the studios offer. The arrays live
 * in `./catalog/*` (one file per modality) purely for file size; import them
 * from here.
 *
 * Controls are never hardcoded against this data — read it through the
 * selectors in `./model-selectors`.
 */
import { t2iModels } from './catalog/t2i-models';
import { t2vModels } from './catalog/t2v-models';
import { i2iModels } from './catalog/i2i-models';
import { i2vModels } from './catalog/i2v-models';
import { v2vModels } from './catalog/v2v-models';
import { lipsyncModels } from './catalog/lipsync-models';
import { recastModels } from './catalog/recast-models';
import { audioModels } from './catalog/audio-models';

export { t2iModels } from './catalog/t2i-models';
export { t2vModels } from './catalog/t2v-models';
export { i2iModels } from './catalog/i2i-models';
export { i2vModels } from './catalog/i2v-models';
export { v2vModels } from './catalog/v2v-models';
export { lipsyncModels } from './catalog/lipsync-models';
export { recastModels } from './catalog/recast-models';
export { audioModels } from './catalog/audio-models';

/** Lip-sync models that take a still image plus audio. */
export const imageLipSyncModels = lipsyncModels.filter((m) => m.category === 'image');

/** Lip-sync models that take an existing video plus audio. */
export const videoLipSyncModels = lipsyncModels.filter((m) => m.category === 'video');

/** Every model in the catalog, across all modalities. */
export const allModels = [
  ...t2iModels,
  ...t2vModels,
  ...i2iModels,
  ...i2vModels,
  ...v2vModels,
  ...lipsyncModels,
  ...recastModels,
  ...audioModels,
];

/**
 * marketer.sh Studio — model selectors.
 *
 * The only sanctioned way to read the model catalog. Every dynamic control
 * (aspect ratio, duration, resolution, quality, effects, modes, image count)
 * derives its options and defaults from a model's `inputs` schema through the
 * helpers below, so adding a model to the catalog is enough to make its
 * controls appear. Never hardcode an option list in a component.
 *
 * Each helper returns a safe fallback for an unknown model id, matching the
 * behaviour the studios rely on.
 */
import type { EnumValue, JsonValue, ModelDefinition } from './types';
import {
  t2iModels,
  t2vModels,
  i2iModels,
  i2vModels,
  v2vModels,
  lipsyncModels,
  recastModels,
  audioModels,
} from './model-catalog';

// ── Lookups ───────────────────────────────────────────────────────────────────

/** Text-to-image model by id. */
export const getModelById = (id: string): ModelDefinition | undefined =>
  t2iModels.find((m) => m.id === id);

/** Text-to-video model by id. */
export const getVideoModelById = (id: string): ModelDefinition | undefined =>
  t2vModels.find((m) => m.id === id);

/** Image-to-image model by id. */
export const getI2IModelById = (id: string): ModelDefinition | undefined =>
  i2iModels.find((m) => m.id === id);

/** Image-to-video model by id. */
export const getI2VModelById = (id: string): ModelDefinition | undefined =>
  i2vModels.find((m) => m.id === id);

/** Video-to-video model by id. */
export const getV2VModelById = (id: string): ModelDefinition | undefined =>
  v2vModels.find((m) => m.id === id);

/** Lip-sync model by id. */
export const getLipSyncModelById = (id: string): ModelDefinition | undefined =>
  lipsyncModels.find((m) => m.id === id);

/** Recast / body-swap model by id. */
export const getRecastModelById = (id: string): ModelDefinition | undefined =>
  recastModels.find((m) => m.id === id);

/** Audio model by id. */
export const getAudioModelById = (id: string): ModelDefinition | undefined =>
  audioModels.find((m) => m.id === id);

// ── Aspect ratios ─────────────────────────────────────────────────────────────

export const getAspectRatiosForModel = (modelId: string): EnumValue[] => {
  const model = getModelById(modelId);
  if (!model) return ['1:1'];

  const arInput = model.inputs?.aspect_ratio;
  if (arInput && arInput.enum) {
    return arInput.enum;
  }

  return ['1:1', '16:9', '9:16', '4:3', '3:2', '21:9'];
};

export const getAspectRatiosForVideoModel = (modelId: string): EnumValue[] => {
  const model = getVideoModelById(modelId);
  if (!model) return ['16:9'];
  const arInput = model.inputs?.aspect_ratio;
  if (arInput && arInput.enum) return arInput.enum;
  return ['16:9', '9:16', '1:1'];
};

export const getAspectRatiosForI2IModel = (modelId: string): EnumValue[] => {
  const model = getI2IModelById(modelId);
  if (!model) return ['1:1'];
  if (model.inputs && model.inputs.aspect_ratio && model.inputs.aspect_ratio.enum)
    return model.inputs.aspect_ratio.enum;
  return ['1:1', '16:9', '9:16'];
};

export const getAspectRatiosForI2VModel = (modelId: string): EnumValue[] => {
  const model = getI2VModelById(modelId);
  if (!model) return ['16:9'];
  if (model.inputs && model.inputs.aspect_ratio && model.inputs.aspect_ratio.enum)
    return model.inputs.aspect_ratio.enum;
  return ['16:9', '9:16', '1:1'];
};

export const getAspectRatiosForRecastModel = (id: string): EnumValue[] => {
  const model = recastModels.find((m) => m.id === id);
  return model?.inputs?.aspect_ratio?.enum || [];
};

// ── Durations ─────────────────────────────────────────────────────────────────

export const getDurationsForModel = (modelId: string): EnumValue[] => {
  const model = getVideoModelById(modelId);
  if (!model) return [5];
  const durInput = model.inputs?.duration;
  if (durInput && durInput.enum) return durInput.enum;
  if (durInput) return [(durInput.default as EnumValue) || 5];
  return [];
};

export const getDurationsForI2VModel = (modelId: string): EnumValue[] => {
  const model = getI2VModelById(modelId);
  if (!model) return [];
  const dur = model.inputs && model.inputs.duration;
  if (!dur) return [];
  if (dur.enum) return dur.enum;
  if (dur.minValue !== undefined && dur.maxValue !== undefined && dur.step) {
    const vals: EnumValue[] = [];
    for (let v = dur.minValue; v <= dur.maxValue; v += dur.step) vals.push(v);
    return vals;
  }
  if (dur.default) return [dur.default as EnumValue];
  return [];
};

// ── Resolution / quality ──────────────────────────────────────────────────────

/** Quality/resolution options for a t2i model. */
export const getResolutionsForModel = (modelId: string): EnumValue[] => {
  const model = getModelById(modelId);
  if (!model) return [];
  if (model.inputs?.resolution?.enum) return model.inputs.resolution.enum;
  if (model.inputs?.quality?.enum) return model.inputs.quality.enum;
  return [];
};

export const getResolutionsForVideoModel = (modelId: string): EnumValue[] => {
  const model = getVideoModelById(modelId);
  if (!model) return [];
  const resInput = model.inputs?.resolution;
  if (resInput && resInput.enum) return resInput.enum;
  return [];
};

export const getResolutionsForI2IModel = (modelId: string): EnumValue[] => {
  const model = getI2IModelById(modelId);
  if (!model) return [];
  if (model.inputs?.resolution?.enum) return model.inputs.resolution.enum;
  if (model.inputs?.quality?.enum) return model.inputs.quality.enum;
  return [];
};

export const getResolutionsForI2VModel = (modelId: string): EnumValue[] => {
  const model = getI2VModelById(modelId);
  if (!model) return [];
  const res = model.inputs && model.inputs.resolution;
  if (res && res.enum) return res.enum;
  return [];
};

export const getResolutionsForLipSyncModel = (id: string): EnumValue[] => {
  const model = lipsyncModels.find((m) => m.id === id);
  return model?.inputs?.resolution?.enum || [];
};

/** Payload field name carrying quality/resolution for a t2i model. */
export const getQualityFieldForModel = (
  modelId: string,
): 'resolution' | 'quality' | null => {
  const model = getModelById(modelId);
  if (!model) return null;
  if (model.inputs?.resolution) return 'resolution';
  if (model.inputs?.quality) return 'quality';
  return null;
};

/** Payload field name carrying quality/resolution for an i2i model. */
export const getQualityFieldForI2IModel = (
  modelId: string,
): 'resolution' | 'quality' | null => {
  const model = getI2IModelById(modelId);
  if (!model) return null;
  if (model.inputs?.resolution) return 'resolution';
  if (model.inputs?.quality) return 'quality';
  return null;
};

// ── Reference image counts ────────────────────────────────────────────────────

/** Maximum number of reference images an i2i model accepts (defaults to 1). */
export const getMaxImagesForI2IModel = (modelId: string): number => {
  const model = getI2IModelById(modelId);
  return model?.maxImages || 1;
};

/** Maximum number of reference images an i2v model accepts (defaults to 1). */
export const getMaxImagesForI2VModel = (modelId: string): number => {
  const model = getI2VModelById(modelId);
  if (!model) return 1;
  if (model.maxImages) return model.maxImages;
  if (model.lastImageField) return 2;
  return 1;
};

// ── Effects ───────────────────────────────────────────────────────────────────
// Effect-style models declare `inputs.name` as an enum of effect types.

export const getEffectsForI2IModel = (modelId: string): EnumValue[] => {
  const model = getI2IModelById(modelId);
  return model?.inputs?.name?.enum || [];
};

export const getDefaultEffectForI2IModel = (modelId: string): JsonValue | null => {
  const model = getI2IModelById(modelId);
  return model?.inputs?.name?.default || null;
};

export const getEffectsForI2VModel = (modelId: string): EnumValue[] => {
  const model = getI2VModelById(modelId);
  return model?.inputs?.name?.enum || [];
};

export const getDefaultEffectForI2VModel = (modelId: string): JsonValue | null => {
  const model = getI2VModelById(modelId);
  return model?.inputs?.name?.default || null;
};

// ── Modes ─────────────────────────────────────────────────────────────────────

export const getModesForModel = (modelId: string): EnumValue[] => {
  const model = [...t2vModels, ...i2vModels].find((m) => m.id === modelId);
  if (!model) return [];
  const modeInput = model.inputs?.mode;
  if (modeInput?.enum) return modeInput.enum;
  return [];
};

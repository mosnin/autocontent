/**
 * marketer.sh Studio model catalog — Recast / body-swap models: source video motion + character image.
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 3 models.
 */
import type { ModelDefinition } from '../types';

export const recastModels: ModelDefinition[] = [
  {
    "id": "kling-v3.0-pro-recast",
    "name": "Kling 3.0 Pro Motion Control",
    "endpoint": "kling-v3.0-pro-motion-control",
    "family": "kling",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "description": "Transfer the motion from your video onto a character image with maximum fidelity."
  },
  {
    "id": "runway-act-two-recast",
    "name": "Runway Act Two",
    "endpoint": "runway-act-two-i2v",
    "family": "runway",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "enum": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        "default": "16:9"
      }
    },
    "description": "Recast any character — drive a character image with the motion and performance from your video."
  }
,
  {
    "id": "wan2.2-animate-recast",
    "name": "Wan2.2 Animate",
    "endpoint": "wan2.2-animate",
    "family": "wan2.2",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "description": "Wan2.2 Animate is a video-to-video model for animating a character or replacing a character in existing video clips."
  }
];

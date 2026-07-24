/**
 * marketer.sh Studio model catalog — Lip-sync models (image+audio and video+audio).
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 15 models.
 */
import type { ModelDefinition } from '../types';

export const lipsyncModels: ModelDefinition[] = [
  // ── Image + Audio → Video ──────────────────────────────────────────────────
  {
    "id": "infinitetalk-image-to-video",
    "name": "Infinite Talk",
    "endpoint": "infinitetalk-image-to-video",
    "family": "infinitetalk",
    "category": "image",
    "hasPrompt": true,
    "description": "Animate a portrait image into a talking video driven by audio.",
    "inputs": {
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "enum": ["480p", "720p"],
        "default": "480p"
      }
    }
  },
  {
    "id": "wan2.2-speech-to-video",
    "name": "Wan 2.2 Speech to Video",
    "endpoint": "wan2.2-speech-to-video",
    "family": "wan",
    "category": "image",
    "hasPrompt": true,
    "description": "Generate a talking portrait video from an image and audio using Wan 2.2.",
    "inputs": {
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "enum": ["480p", "720p"],
        "default": "480p"
      }
    }
  },
  {
    "id": "ltx-2.3-lipsync",
    "name": "LTX 2.3 Lipsync",
    "endpoint": "ltx-2.3-lipsync",
    "family": "ltx",
    "category": "image",
    "hasPrompt": true,
    "hasSeed": true,
    "description": "High-quality lipsync from portrait image and audio using LTX 2.3.",
    "inputs": {
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "enum": ["480p", "720p", "1080p"],
        "default": "720p"
      }
    }
  },
  {
    "id": "ltx-2-19b-lipsync",
    "name": "LTX 2 19B Lipsync",
    "endpoint": "ltx-2-19b-lipsync",
    "family": "ltx",
    "category": "image",
    "hasPrompt": true,
    "description": "Lipsync from portrait image and audio using LTX 2 19B model.",
    "inputs": {
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "enum": ["480p", "720p", "1080p"],
        "default": "720p"
      }
    }
  },
  // ── Video + Audio → Video ──────────────────────────────────────────────────
  {
    "id": "sync-lipsync",
    "name": "Sync Lipsync",
    "endpoint": "sync-lipsync",
    "family": "lipsync",
    "category": "video",
    "hasPrompt": false,
    "description": "Generate realistic lipsync animations from audio using Sync's advanced algorithms."
  },
  {
    "id": "latent-sync",
    "name": "LatentSync",
    "endpoint": "latentsync-video",
    "family": "lipsync",
    "category": "video",
    "hasPrompt": false,
    "description": "Video-to-video lipsync using LatentSync for high-quality audio-driven lip animations."
  },
  {
    "id": "creatify-lipsync",
    "name": "Creatify Lipsync",
    "endpoint": "creatify-lipsync",
    "family": "lipsync",
    "category": "video",
    "hasPrompt": false,
    "description": "Realistic lipsync video optimized for speed, quality, and consistency by Creatify."
  },
  {
    "id": "veed-lipsync",
    "name": "Veed Lipsync",
    "endpoint": "veed-lipsync",
    "family": "lipsync",
    "category": "video",
    "hasPrompt": false,
    "description": "Generate realistic lipsync from any audio using VEED's latest model."
  },
  {
    "id": "infinitetalk-video-to-video",
    "name": "Infinite Talk V2V",
    "endpoint": "infinitetalk-video-to-video",
    "family": "infinitetalk",
    "category": "video",
    "hasPrompt": true,
    "description": "Apply audio-driven lipsync to an existing video using Infinite Talk.",
    "inputs": {
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "enum": ["480p", "720p"],
        "default": "480p"
      }
    }
  }
,
  {
    "id": "volcengine-video-to-video-lip-sync",
    "name": "Volcengine Video to Video Lip Sync",
    "endpoint": "volcengine-video-to-video-lip-sync",
    "family": "volcengine-lipsync",
    "category": "video",
    "hasPrompt": false,
    "description": "Drive a video's lip movements to match a target audio track, producing a lip-synced video output.",
    "inputs": {
      "mode": {
        "enum": [
          "lite",
          "basic"
        ],
        "type": "string",
        "title": "Mode",
        "name": "mode",
        "description": "Service mode. 'lite' is for single-person frontal videos with faster processing. 'basic' is for single-person complex scenes, supporting scene segmentation and speaker identification.",
        "default": "lite"
      }
    }
  },
  {
    "id": "kling-v1-avatar-standard",
    "name": "Kling v1 Avatar Standard",
    "endpoint": "kling-v1-avatar-standard",
    "family": "kling-v1",
    "category": "image",
    "hasPrompt": true,
    "description": "Kling AI Avatar Standard creates talking avatar videos from a single image + audio input."
  },
  {
    "id": "kling-v1-avatar-pro",
    "name": "Kling v1 Avatar Pro",
    "endpoint": "kling-v1-avatar-pro",
    "family": "kling-v1",
    "category": "image",
    "hasPrompt": true,
    "description": "Kling AI Avatar Pro is the premium tier for making high-quality talking avatars."
  },
  {
    "id": "kling-v2-avatar-standard",
    "name": "Kling v2 Avatar Standard",
    "endpoint": "kling-v2-avatar-standard",
    "family": "kling-v2",
    "category": "image",
    "hasPrompt": true,
    "description": "AI-Avatar v2 Standard generates a talking-avatar video from a reference image and an audio dialogue."
  },
  {
    "id": "kling-v2-avatar-pro",
    "name": "Kling v2 Avatar Pro",
    "endpoint": "kling-v2-avatar-pro",
    "family": "kling-v2",
    "category": "image",
    "hasPrompt": true,
    "description": "AI-Avatar v2 Pro takes a reference image of a person/character and an audio dialogue clip, then generates a realistic talking-avatar video."
  },
  {
    "id": "omnihuman-1-5",
    "name": "Omnihuman 1 5",
    "endpoint": "omnihuman-1-5",
    "family": "omnihuman",
    "category": "image",
    "hasPrompt": true,
    "description": "Generate realistic talking head video from portrait image and audio using KIE OmniHuman 1.5.",
    "inputs": {
      "output_resolution": {
        "enum": [
          "720",
          "1080"
        ],
        "type": "string",
        "title": "Output Resolution",
        "name": "output_resolution",
        "description": "Output video resolution.",
        "default": "1080"
      }
    }
  }
];

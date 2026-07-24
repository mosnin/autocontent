/**
 * marketer.sh Studio model catalog — Text-to-video models.
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 87 models.
 */
import type { ModelDefinition } from '../types';

export const t2vModels: ModelDefinition[] = [
  {
    "id": "seedance-lite-t2v",
    "name": "Seedance Lite",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 12,
        "step": 1
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-pro-t2v",
    "name": "Seedance Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 12,
        "step": 1
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-pro-t2v-fast",
    "name": "Seedance Pro Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 2,
        "maxValue": 12,
        "step": 1
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-v1.5-pro-t2v",
    "name": "Seedance v1.5 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 4,
        "maxValue": 12,
        "step": 1
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-v1.5-pro-t2v-fast",
    "name": "Seedance v1.5 Pro Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 4,
        "maxValue": 12,
        "step": 1
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-v2.0-t2v",
    "name": "Seedance 2.0",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          10,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "Quality of the generated video.",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-v2.0-extend",
    "name": "Seedance 2.0 Extend",
    "requiresRequestId": true,
    "inputs": {
      "request_id": {
        "type": "string",
        "title": "Request ID",
        "name": "request_id",
        "description": "Request ID of the original Seedance 2.0 video generation.",
        "placeholder": "abcdefg-123-456-789-a1b2c3d4e5f6"
      },
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional prompt to guide the extension. Reference images with @image2…@image9, videos with @video1…@video3 (the source video's last frame is always @image1)."
      },
      "images_list": {
        "type": "array",
        "title": "Reference Images",
        "name": "images_list",
        "description": "Up to 8 additional reference image URLs. Each Nth image maps to @image(N+1) in the prompt.",
        "maxItems": 8
      },
      "video_files": {
        "type": "array",
        "title": "Reference Videos",
        "name": "video_files",
        "description": "Up to 3 reference video clip URLs (MP4, max 15s each). Each Nth video maps to @videoN in the prompt.",
        "maxItems": 3
      },
      "duration": {
        "enum": [
          5,
          10,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video extension in seconds",
        "default": 5
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "Quality of the generated video.",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "kling-v2.1-master-t2v",
    "name": "Kling v2.1 Master",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v2.5-turbo-pro-t2v",
    "name": "Kling v2.5 Turbo Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "9:16"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v2.6-pro-t2v",
    "name": "Kling v2.6 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          10
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-o1-text-to-video",
    "name": "Kling O1 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          10
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-pro-text-to-video",
    "name": "Kling v3.0 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated video",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-standard-text-to-video",
    "name": "Kling v3.0 Standard",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated video",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "veo3-text-to-video",
    "name": "Veo 3",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired video content."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3-fast-text-to-video",
    "name": "Veo 3 Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired video content."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-text-to-video",
    "name": "Veo 3.1",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          8
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 8
      },
      "resolution": {
        "enum": [
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "1080p"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-fast-text-to-video",
    "name": "Veo 3.1 Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          8
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 8
      },
      "resolution": {
        "enum": [
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "1080p"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-lite-text-to-video",
    "name": "Veo 3.1 Lite",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          8
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 8
      },
      "resolution": {
        "enum": [
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "1080p"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "runway-text-to-video",
    "name": "Runway Gen-3",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to be used to generate a video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          8
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration in seconds. If 8-second video is selected, 1080p resolution cannot be used.",
        "default": 5
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video. If 1080p is selected, 8-second video cannot be generated.",
        "default": "720p"
      }
    },
    "provider": "runway",
    "provider_name": "RunwayML"
  },
  {
    "id": "wan2.1-text-to-video",
    "name": "Wan 2.1",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      },
      "quality": {
        "enum": [
          "medium",
          "high"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "The quality of the generated video.",
        "default": "medium"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.2-text-to-video",
    "name": "Wan 2.2",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 5,
        "maxValue": 8,
        "step": 3
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      },
      "quality": {
        "enum": [
          "medium",
          "high"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "The quality of the generated video.",
        "default": "medium"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.2-5b-fast-t2v",
    "name": "Wan 2.2 Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "580p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.5-text-to-video",
    "name": "Wan 2.5",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.5-text-to-video-fast",
    "name": "Wan 2.5 Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.6-text-to-video",
    "name": "Wan 2.6",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          10,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "hunyuan-text-to-video",
    "name": "Hunyuan",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      }
    },
    "provider": "hunyuan",
    "provider_name": "Hunyuan"
  },
  {
    "id": "hunyuan-fast-text-to-video",
    "name": "Hunyuan Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      }
    },
    "provider": "hunyuan",
    "provider_name": "Hunyuan"
  },
  {
    "id": "pixverse-v4.5-t2v",
    "name": "Pixverse v4.5",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds. 8s not supported for 1080p resolution.",
        "default": 5,
        "minValue": 5,
        "maxValue": 8,
        "step": 3
      },
      "resolution": {
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "pixverse-v5-t2v",
    "name": "Pixverse v5",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 8,
        "step": 3
      },
      "resolution": {
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "pixverse-v5.5-t2v",
    "name": "Pixverse v5.5",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          8,
          10
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5
      },
      "resolution": {
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "360p"
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "minimax-hailuo-02-standard-t2v",
    "name": "Hailuo 02 Standard",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "duration": {
        "enum": [
          6,
          10
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 6
      },
      "resolution": {
        "enum": [
          "768P"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "768P"
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "minimax-hailuo-02-pro-t2v",
    "name": "Hailuo 02 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "duration": {
        "enum": [
          6
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 6
      },
      "resolution": {
        "enum": [
          "1080P"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "1080P"
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "minimax-hailuo-2.3-pro-t2v",
    "name": "Hailuo 2.3 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "resolution": {
        "enum": [
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "1080p"
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "minimax-hailuo-2.3-standard-t2v",
    "name": "Hailuo 2.3 Standard",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "duration": {
        "enum": [
          6,
          10
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 6
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "openai-sora",
    "name": "Sora",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "480p"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "openai-sora-2-text-to-video",
    "name": "Sora 2",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          10,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 10
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "openai-sora-2-pro-text-to-video",
    "name": "Sora 2 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          10,
          15,
          25
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds. Currently 25 seconds supports 720p only.",
        "default": 10
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "vidu-v2.0-t2v",
    "name": "Vidu v2.0",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video"
      },
      "aspect_ratio": {
        "enum": [
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "9:16"
      },
      "duration": {
        "enum": [
          4
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 4
      },
      "resolution": {
        "enum": [
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "1080p"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "ovi-text-to-video",
    "name": "OVI",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "grok-imagine-text-to-video",
    "name": "Grok Imagine",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "9:16",
          "16:9",
          "2:3",
          "3:2",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "1:1"
      },
      "mode": {
        "enum": [
          "fun",
          "normal",
          "spicy"
        ],
        "title": "Mode",
        "name": "mode",
        "type": "string",
        "description": "Generation style: normal = standard output; fun = more creative/expressive; spicy = edgier content (text-to-video only).",
        "default": "normal"
      },
      "duration": {
        "enum": [
          6,
          10,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 6
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "ltx-2-pro-text-to-video",
    "name": "LTX 2 Pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "duration": {
        "enum": [
          6,
          8,
          10
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 6
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "ltx-2-fast-text-to-video",
    "name": "LTX 2 Fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "duration": {
        "enum": [
          6,
          8,
          10,
          12,
          14,
          16,
          18,
          20
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 6
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "ltx-2-19b-text-to-video",
    "name": "LTX 2 19B",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated video",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 20,
        "step": 1
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  }
,
  {
    "id": "veo3.1-extend-video",
    "name": "Veo3.1 Extend Video",
    "requiresRequestId": true,
    "endpoint": "veo3.1-extend-video",
    "inputs": {
      "request_id": {
        "examples": [
          ""
        ],
        "description": "Request ID of the original video generation. Must be a valid Id returned from the video generation interface.",
        "format": "text",
        "type": "string",
        "title": "Request Id",
        "name": "request_id",
        "placeholder": "abcdefg-123-456-789-a1b2c3d4e5f6"
      },
      "prompt": {
        "examples": [
          ""
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-4k-video",
    "name": "Veo3.1 4K Video",
    "requiresRequestId": true,
    "endpoint": "veo3.1-4k-video",
    "inputs": {
      "request_id": {
        "examples": [
          ""
        ],
        "description": "Request ID of the original video generation. Must be a valid Id returned from the video generation interface.",
        "format": "text",
        "type": "string",
        "title": "Request Id",
        "name": "request_id",
        "placeholder": "a8a09145bde3fb496ecd00ce4777a295"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "seedance-2-t2v",
    "name": "Seedance 2 T2V",
    "endpoint": "seedance-v2.0-t2v",
    "inputs": {
      "prompt": {
        "examples": [
          "A determined penguin straps itself into a homemade rocket sled on an icy mountain. The rocket ignites with a massive burst and launches the penguin across the frozen landscape at insane speed, blasting through snowdrifts and leaving a fiery trail behind."
        ],
        "type": "string",
        "title": "Prompt",
        "description": "Text prompt describing the video. To use a fictional character, reference it inline with @character:<id> (the request_id from a completed Seedance 2 Character generation). Multiple characters are supported. Example: '@character:ab539e5f walks on the beach at sunset'."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "type": "string",
        "default": "16:9"
      },
      "duration": {
        "enum": [
          5,
          10,
          15
        ],
        "title": "Duration",
        "type": "integer",
        "default": 5
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "type": "string",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-extend",
    "name": "Seedance 2 Extend",
    "requiresRequestId": true,
    "endpoint": "seedance-v2.0-extend",
    "inputs": {
      "request_id": {
        "examples": [
          "cab9517f-1818-4910-8d66-292701c78c2d"
        ],
        "description": "Request ID of the original Seedance 2.0 video generation.",
        "format": "text",
        "type": "string",
        "title": "Request Id",
        "name": "request_id",
        "placeholder": "abcdefg-123-456-789-a1b2c3d4e5f6"
      },
      "prompt": {
        "examples": [
          ""
        ],
        "description": "Optional prompt to guide the extension. Reference additional images with @image2…@image9, videos with @video1…@video3, and audio with @audio1…@audio3 — the source video's last frame is always @image1.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [],
        "description": "Up to 8 additional reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @image(N+1) in the prompt (the source video's last frame is @image1).",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 8
      },
      "video_files": {
        "examples": [],
        "description": "Up to 3 reference video clip URLs (MP4, max 15s each). Each Nth video corresponds to @videoN in the prompt.",
        "field": "videos_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Video Reference URLs",
        "name": "video_files",
        "maxItems": 3
      },
      "audio_files": {
        "examples": [],
        "description": "Up to 3 reference audio clip URLs (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
        "field": "audios_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Audio Reference URLs",
        "name": "audio_files",
        "maxItems": 3
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Output video aspect ratio (only used when reference images/videos/audio are provided)."
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Length of the extension clip in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "type": "string",
        "name": "quality",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "ltx-2.3-text-to-video",
    "name": "LTX 2.3",
    "endpoint": "ltx-2.3-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A high-speed train suddenly bursts through the wall of a quiet apartment building and races straight through the living rooms and hallways. Furniture flies everywhere as the train blasts through multiple floors before exiting the other side of the building."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Duration of the generated video in seconds.",
        "default": 5,
        "minValue": 5,
        "maxValue": 20,
        "step": 1
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the generated video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      },
      "seed": {
        "title": "Seed",
        "name": "seed",
        "type": "int",
        "description": "Random seed. -1 for random.",
        "default": -1
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "openai-sora-2-standard-text-to-video",
    "name": "Sora 2 Standard",
    "endpoint": "openai-sora-2-standard-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video you want to generate",
        "examples": [
          "The lava knight slams the cup onto the table, sending molten sparks everywhere. The ground cracks open beneath him as lava erupts from his armor. The café explodes into chaos with chairs flipping, flames rising, and molten lava splashing across the floor."
        ]
      },
      "mode": {
        "enum": [
          "budget",
          "stable"
        ],
        "type": "string",
        "title": "Mode",
        "name": "mode",
        "description": "Generation mode (budget is cheaper, stable is more expensive)",
        "default": "stable"
      },
      "seconds": {
        "enum": [
          "10",
          "15"
        ],
        "enum_dependencies": {
          "mode": {
            "stable": [
              "10"
            ],
            "budget": [
              "10",
              "15"
            ]
          }
        },
        "type": "string",
        "title": "Seconds",
        "name": "seconds",
        "description": "Video duration in seconds",
        "default": "10"
      },
      "size": {
        "enum": [
          "720x1280",
          "1280x720"
        ],
        "type": "string",
        "title": "Size",
        "name": "size",
        "description": "Video dimensions (Width x Height)",
        "default": "720x1280"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "seedance-2-new-t2v",
    "name": "Seedance 2 New T2V",
    "endpoint": "seedance-2.0-new-t2v",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "high = standard model (slower, better quality); basic = fast model.",
        "default": "basic"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds (4–15).",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "grok-imagine-extend",
    "name": "Grok Imagine Extend",
    "requiresRequestId": true,
    "endpoint": "grok-imagine-extend",
    "inputs": {
      "request_id": {
        "examples": [
          ""
        ],
        "description": "Request ID of the original video generation. Must be a valid ID returned from a previous Grok Imagine video generation.",
        "format": "text",
        "type": "string",
        "title": "Request Id",
        "name": "request_id",
        "placeholder": "abcdefg-123-456-789-a1b2c3d4e5f6"
      },
      "prompt": {
        "examples": [
          "Continue the scene with the camera slowly panning right to reveal a vast ocean horizon, golden sunset light reflecting on the water."
        ],
        "description": "Text prompt describing how to continue the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "extend_times": {
        "enum": [
          6,
          10
        ],
        "title": "Extend Duration",
        "name": "extend_times",
        "type": "integer",
        "description": "Duration in seconds to extend the video.",
        "default": 6
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "480p"
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "pixverse-v6-t2v",
    "name": "Pixverse v6 T2V",
    "endpoint": "pixverse-v6-t2v",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "A young woman sprints through a dense futuristic city street when gravity suddenly shifts sideways. Cars slide across buildings, streetlights bend, and debris floats mid-air. She jumps between tilted surfaces while the camera dynamically rotates with the changing gravity, creating a disorienting chase sequence with intense motion blur and sparks flying."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "2:3",
          "3:2",
          "21:9"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "Output video resolution.",
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 1,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio_switch": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio_switch",
        "description": "Enable AI-generated audio for the video.",
        "default": false
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "wan2.7-text-to-video",
    "name": "Wan2.7",
    "endpoint": "wan2.7-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description",
        "examples": [
          "A cinematic video..."
        ]
      },
      "audio_url": {
        "type": "string",
        "title": "Audio URL",
        "name": "audio_url",
        "description": "Audio file to guide generation",
        "field": "audio",
        "examples": []
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "Output resolution",
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "Video duration in seconds (2-15).",
        "default": 5,
        "minValue": 2,
        "maxValue": 15,
        "step": 1
      },
      "negative_prompt": {
        "examples": [],
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "What not to generate"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "seedance-2-t2v-480p",
    "name": "Seedance 2 T2V 480P",
    "endpoint": "seedance-2.0-t2v-480p",
    "inputs": {
      "prompt": {
        "examples": [
          "A determined penguin straps itself into a homemade rocket sled on an icy mountain. The rocket ignites with a massive burst and launches the penguin across the frozen landscape at insane speed, blasting through snowdrifts and leaving a fiery trail behind."
        ],
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video. To use a fictional character, reference it inline with @character:<id> (the request_id from a completed Seedance 2 Character generation). Multiple characters are supported. Example: '@character:ab539e5f walks on the beach at sunset'."
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "high=$0.15/sec, basic=$0.12/sec",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-text-to-video",
    "name": "Seedance 2",
    "endpoint": "seedance-2-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate. Use @character:<id> to anchor the video to a Seedance 2 character — automatically switches to image-to-video mode.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-text-to-video-fast",
    "name": "Seedance 2 Text to Video Fast",
    "endpoint": "seedance-2-text-to-video-fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate. Use @character:<id> to anchor the video to a Seedance 2 character — automatically switches to image-to-video mode.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-vip-text-to-video",
    "name": "Seedance 2 VIP",
    "endpoint": "seedance-2-vip-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate. Use @character:<id> to anchor the video to a Seedance 2 character — automatically switches to image-to-video mode. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-vip-text-to-video-fast",
    "name": "Seedance 2 VIP Text to Video Fast",
    "endpoint": "seedance-2-vip-text-to-video-fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate. Use @character:<id> to anchor the video to a Seedance 2 character — automatically switches to image-to-video mode. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "happy-horse-1-text-to-video-1080p",
    "name": "Happy Horse 1 Text to Video 1080P",
    "endpoint": "happy-horse-1-text-to-video-1080p",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video content.",
        "examples": [
          "A horse hosting a live cooking show confidently flips a pancake into the air, but the pancake catches fire and triggers a chain reaction of explosions throughout the kitchen. Pots launch into the air, flames burst from ovens, and the horse continues cooking like nothing is wrong."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1-text-to-video-720p",
    "name": "Happy Horse 1 Text to Video 720P",
    "endpoint": "happy-horse-1-text-to-video-720p",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video content.",
        "examples": [
          "Inside a crowded airplane cabin, a horse wearing a pilot uniform suddenly realizes the plane is flying upside down. Passengers and luggage slam into the ceiling while drink carts roll wildly through the aisle. The horse panics and runs toward the cockpit as turbulence shakes the entire plane violently."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "veo-4-text-to-video",
    "name": "Veo 4",
    "endpoint": "veo-4-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video content.",
        "examples": [
          "A cinematic aerial shot of a city at dusk, golden hour lighting, slow dolly forward."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 8,
        "minValue": 5,
        "maxValue": 30,
        "step": 1
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "seedance-2-vip-text-to-video-1080p",
    "name": "Seedance 2 VIP Text to Video 1080P",
    "endpoint": "sd-2-vip-text-to-video-1080p",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-vip-text-to-video-fast-1080p",
    "name": "Seedance 2 VIP Text to Video Fast 1080P",
    "endpoint": "sd-2-vip-text-to-video-fast-1080p",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "kling-v3.0-4k-text-to-video",
    "name": "Kling v3.0 4K",
    "endpoint": "kling-v3.0-4k-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A close-up view of a mechanical watch lying open on a dark surface. As the video plays, the internal gears begin turning smoothly, tiny springs flex and release, and the balance wheel oscillates rhythmically. Light reflections glide across polished metal parts while the camera slowly pans sideways, revealing the layered precision of the mechanism. Studio lighting, macro detail, clean background, calm and satisfying motion."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated video"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "default": true,
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio for the video"
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "vidu-q3-pro-text-to-video",
    "name": "Vidu Q3 Pro",
    "endpoint": "vidu-q3-pro-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "The whale crashes downward through the street, releasing an enormous wave of water that floods the city instantly. Cars flip and streetlights bend while the camera dives through the rushing floodwater beside the whale."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "resolution": {
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 1,
        "maxValue": 16,
        "step": 1
      },
      "audio": {
        "type": "boolean",
        "title": "Audio",
        "name": "audio",
        "description": "Whether to generate audio for the video.",
        "default": false
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "vidu-q3-turbo-text-to-video",
    "name": "Vidu Q3 Turbo",
    "endpoint": "vidu-q3-turbo-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A tiny astronaut standing on a kitchen countertop beside giant cooking equipment, dramatic cinematic scale contrast"
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "resolution": {
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 1,
        "maxValue": 16,
        "step": 1
      },
      "audio": {
        "type": "boolean",
        "title": "Audio",
        "name": "audio",
        "description": "Whether to generate audio for the video.",
        "default": false
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "vidu-q2-pro-text-to-video",
    "name": "Vidu Q2 Pro",
    "endpoint": "vidu-q2-pro-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A lone astronaut walks slowly across a cracked Martian plain at dusk, her boots kicking up rust-coloured dust. The camera tracks beside her in a slow dolly as twin moons rise over distant mesas, soft volumetric light spilling across her visor."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 2,
        "maxValue": 8,
        "step": 1
      },
      "bgm": {
        "type": "boolean",
        "title": "Bgm",
        "name": "bgm",
        "description": "Add background music to the output. When enabled, duration must be exactly 4 seconds.",
        "default": false
      },
      "movement_amplitude": {
        "enum": [
          "auto",
          "small",
          "medium",
          "large"
        ],
        "title": "Movement Amplitude",
        "name": "movement_amplitude",
        "type": "string",
        "description": "The movement amplitude of objects in the frame.",
        "default": "auto"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "vidu-q2-turbo-text-to-video",
    "name": "Vidu Q2 Turbo",
    "endpoint": "vidu-q2-turbo-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A skateboarder carves down a sunlit Tokyo backstreet at golden hour. The camera follows in a smooth tracking shot as neon signs flicker on."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated video.",
        "default": "720p"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 2,
        "maxValue": 8,
        "step": 1
      },
      "bgm": {
        "type": "boolean",
        "title": "Bgm",
        "name": "bgm",
        "description": "Add background music to the output. When enabled, duration must be exactly 4 seconds.",
        "default": false
      },
      "movement_amplitude": {
        "enum": [
          "auto",
          "small",
          "medium",
          "large"
        ],
        "title": "Movement Amplitude",
        "name": "movement_amplitude",
        "type": "string",
        "description": "The movement amplitude of objects in the frame.",
        "default": "auto"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "seedance-2-vip-extend",
    "name": "Seedance 2 VIP Extend",
    "requiresRequestId": true,
    "endpoint": "sd-2-vip-extend",
    "inputs": {
      "request_id": {
        "examples": [
          "cab9517f-1818-4910-8d66-292701c78c2d"
        ],
        "description": "Request ID of the original Seedance 2.0 video generation.",
        "format": "text",
        "type": "string",
        "title": "Request Id",
        "name": "request_id",
        "placeholder": "abcdefg-123-456-789-a1b2c3d4e5f6"
      },
      "prompt": {
        "examples": [
          ""
        ],
        "description": "Optional prompt to guide the extension. Reference additional images with @image2…@image9, videos with @video1…@video3, and audio with @audio1…@audio3 — the source video's last frame is always @image1.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [],
        "description": "Up to 8 additional reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @image(N+1) in the prompt (the source video's last frame is @image1).",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 8
      },
      "video_files": {
        "examples": [],
        "description": "Up to 3 reference video clip URLs (MP4, max 15s each). Each Nth video corresponds to @videoN in the prompt.",
        "field": "videos_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Video Reference URLs",
        "name": "video_files",
        "maxItems": 3
      },
      "audio_files": {
        "examples": [],
        "description": "Up to 3 reference audio clip URLs (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
        "field": "audios_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Audio Reference URLs",
        "name": "audio_files",
        "maxItems": 3
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Output video aspect ratio (only used when reference images/videos/audio are provided)."
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Length of the extension clip in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "type": "string",
        "name": "quality",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-vip-extend-1080p",
    "name": "Seedance 2 VIP Extend 1080P",
    "requiresRequestId": true,
    "endpoint": "sd-2-vip-extend-1080p",
    "inputs": {
      "request_id": {
        "examples": [
          "cab9517f-1818-4910-8d66-292701c78c2d"
        ],
        "description": "Request ID of the original Seedance 2.0 video generation.",
        "format": "text",
        "type": "string",
        "title": "Request Id",
        "name": "request_id",
        "placeholder": "abcdefg-123-456-789-a1b2c3d4e5f6"
      },
      "prompt": {
        "examples": [
          ""
        ],
        "description": "Optional prompt to guide the extension. Reference additional images with @image2…@image9, videos with @video1…@video3, and audio with @audio1…@audio3 — the source video's last frame is always @image1.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [],
        "description": "Up to 8 additional reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @image(N+1) in the prompt (the source video's last frame is @image1).",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 8
      },
      "video_files": {
        "examples": [],
        "description": "Up to 3 reference video clip URLs (MP4, max 15s each). Each Nth video corresponds to @videoN in the prompt.",
        "field": "videos_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Video Reference URLs",
        "name": "video_files",
        "maxItems": 3
      },
      "audio_files": {
        "examples": [],
        "description": "Up to 3 reference audio clip URLs (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
        "field": "audios_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Audio Reference URLs",
        "name": "audio_files",
        "maxItems": 3
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Output video aspect ratio (only used when reference images/videos/audio are provided)."
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Length of the extension clip in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "type": "string",
        "name": "quality",
        "default": "high"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "kling-v3.0-omni-standard-text-to-video",
    "name": "Kling v3.0 Omni Standard",
    "endpoint": "kling-v3.0-omni-standard-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A cyberpunk samurai crouched on a rooftop edge during a thunderstorm, glowing katana in hand. The samurai instantly launches forward across rooftops at extreme speed. Rain sprays behind each landing while he slices through neon signs and wall-runs across skyscrapers. The camera whips aggressively around every movement."
        ],
        "description": "Text prompt. Reference images via <<<image_N>>> (1-indexed). If omitted, <<<image_1>>> is auto-prepended.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "9:16",
          "16:9",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Aspect ratio of the output video."
      },
      "duration": {
        "enum": [
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Duration of the generated video in seconds.",
        "default": 5
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "When enabled, generate native audio with the video (adds to cost).",
        "default": false
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-omni-pro-text-to-video",
    "name": "Kling v3.0 Omni Pro",
    "endpoint": "kling-v3.0-omni-pro-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A destroyed city street with broken buildings, smoke, and rubble everywhere. A colossal hand descends from the clouds and begins rebuilding the city like toy blocks. Buildings rise from rubble, roads reconnect, and cars reassemble in reverse. The camera moves through the reconstruction as the hand reshapes the world."
        ],
        "description": "Text prompt. Reference images via <<<image_N>>> (1-indexed). If omitted, <<<image_1>>> is auto-prepended.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "9:16",
          "16:9",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Aspect ratio of the output video."
      },
      "duration": {
        "enum": [
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Duration of the generated video in seconds.",
        "default": 5
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "When enabled, generate native audio with the video (adds to cost).",
        "default": false
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-omni-4k-text-to-video",
    "name": "Kling v3.0 Omni 4K",
    "endpoint": "kling-v3.0-omni-4k-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A destroyed city street with broken buildings, smoke, and rubble everywhere. A colossal hand descends from the clouds and begins rebuilding the city like toy blocks. Buildings rise from rubble, roads reconnect, and cars reassemble in reverse. The camera moves through the reconstruction as the hand reshapes the world."
        ],
        "description": "Text prompt. Reference images via <<<image_N>>> (1-indexed). If omitted, <<<image_1>>> is auto-prepended.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "9:16",
          "16:9",
          "1:1"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Aspect ratio of the output video."
      },
      "duration": {
        "enum": [
          3,
          4,
          5,
          6,
          7,
          8,
          9,
          10,
          11,
          12,
          13,
          14,
          15
        ],
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Duration of the generated video in seconds.",
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "gemini-omni-text-to-video",
    "name": "Gemini Omni",
    "endpoint": "gemini-omni-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video content. Gemini Omni supports rich multimodal prompts including scene composition, camera direction, dialogue, and ambient audio cues.",
        "examples": [
          "A clock begins ticking louder and rapidly grows larger, breaking through the table and floor. Its gears spin violently as the hands rotate uncontrollably. Walls crack apart as the giant clock expands until it fills the entire apartment."
        ]
      },
      "duration": {
        "enum": [
          4,
          6,
          8,
          10
        ],
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Duration of the generated video in seconds.",
        "default": 8
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p",
          "4k"
        ],
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "Output video resolution. 720p and 1080p are the same price; 4K costs more.",
        "default": "1080p"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "audio_ids": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Audio IDs",
        "name": "audio_ids",
        "description": "Up to 3 voice profile IDs returned by the Gemini Omni Audio endpoint.",
        "maxItems": 3
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Random seed (0–2147483647). Fix for reproducibility; results may still vary due to model stochasticity.",
        "minValue": 0,
        "maxValue": 2147483647,
        "default": 0
      },
      "character_ids": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Character IDs",
        "name": "character_ids",
        "description": "Up to 3 character IDs from Gemini Omni Character to feature in the video.",
        "maxItems": 3
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "kling-v3-turbo-standard-text-to-video",
    "name": "Kling v3 Turbo Standard",
    "endpoint": "kling-v3-turbo-standard-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "The biker accelerates instantly as the city folds into impossible geometric shapes around him. Roads twist vertically and buildings rotate through the air. Sparks fly during aggressive drifts while the camera tracks tightly behind."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9",
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated video."
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "Duration of the generated video in seconds (3–15).",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3-turbo-pro-text-to-video",
    "name": "Kling v3 Turbo Pro",
    "endpoint": "kling-v3-turbo-pro-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "A player slams the ball through the hoop and the court instantly erupts into lava. Shockwaves crack the arena floor while flaming debris blasts upward into the crowd. The camera swings dramatically around the impact."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9",
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated video."
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "Duration of the generated video in seconds (3–15).",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "seedance-2.1-text-to-video",
    "name": "Seedance 2.1",
    "endpoint": "seedance-2.1-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal floating city drifts above luminous clouds at dusk, golden energy streams flowing between its towers, cinematic wide shot with subtle camera push, epic atmospheric lighting."
        ],
        "description": "Text prompt describing the video scene and motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "720p"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 12,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio for the video.",
        "default": true
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2.5-text-to-video",
    "name": "Seedance 2.5",
    "endpoint": "seedance-2.5-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A photorealistic aerial view of a vast ancient temple complex at golden hour, rivers of molten light streaming between colossal stone pillars, slow majestic crane shot ascending to reveal surrounding jungle, 4K cinematic depth and color grading."
        ],
        "description": "Text prompt describing the video scene and motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p",
          "4K"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "1080p"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 16,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio for the video.",
        "default": true
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-mini-text-to-video",
    "name": "Seedance 2 Mini",
    "endpoint": "seedance-2-mini-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A golden retriever running through a sunlit meadow, slow motion, vibrant summer colors, wide angle shot."
        ],
        "description": "Text prompt describing the video scene and motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "720p"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate AI audio synchronized with the video.",
        "default": true
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "happy-horse-1.1-text-to-video-1080p",
    "name": "Happy Horse 1.1 Text to Video 1080P",
    "endpoint": "happy-horse-1.1-text-to-video-1080p",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video content.",
        "examples": [
          "A horse hosting a live cooking show confidently flips a pancake into the air, but the pancake catches fire and triggers a chain reaction of explosions throughout the kitchen."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1.1-text-to-video-720p",
    "name": "Happy Horse 1.1 Text to Video 720P",
    "endpoint": "happy-horse-1.1-text-to-video-720p",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video content.",
        "examples": [
          "A horse hosting a live cooking show confidently flips a pancake into the air, but the pancake catches fire and triggers a chain reaction of explosions throughout the kitchen."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "seedance-2-mini-omni-reference",
    "name": "Seedance 2 Mini Omni Reference",
    "endpoint": "seedance-2-mini-omni-reference",
    "inputs": {
      "prompt": {
        "examples": [
          "The character walks forward confidently in a sunny meadow, camera follows from behind."
        ],
        "description": "Text prompt. Reference images with @image1..@image9, videos with @video1..@video3, audio with @audio1..@audio3.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v1.5-pro-i2v.jpg"
        ],
        "description": "Up to 9 reference images (JPEG/PNG/WebP). Referenced in prompt via @image1..@image9.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
      },
      "video_files": {
        "examples": [
          ""
        ],
        "description": "Up to 3 reference video clips (MP4, total max 15s). Referenced in prompt via @video1..@video3.",
        "field": "videos_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Videos",
        "name": "video_files",
        "maxItems": 3
      },
      "audio_files": {
        "examples": [
          ""
        ],
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Referenced in prompt via @audio1..@audio3.",
        "field": "audios_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Audio",
        "name": "audio_files",
        "maxItems": 3
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "720p"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate AI audio synchronized with the video.",
        "default": true
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-vip-text-to-video-4k",
    "name": "Seedance 2 VIP Text to Video 4K",
    "endpoint": "sd-2-vip-text-to-video-4k",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2.5-spicy-text-to-video",
    "name": "Seedance 2.5 Spicy",
    "endpoint": "seedance-2.5-spicy-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A high-contrast, adrenaline-fueled chase through a rain-soaked neon megacity at night, sparks and shattering glass in slow motion, aggressive handheld camera energy, exaggerated color grading, 4K cinematic quality."
        ],
        "description": "Text prompt describing the video scene and motion. Spicy mode favors bolder, higher-contrast, more expressive results.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p",
          "1080p",
          "4K"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "1080p"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 16,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio for the video.",
        "default": true
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-spicy-text-to-video",
    "name": "Seedance 2 Spicy",
    "endpoint": "seedance-2-spicy-text-to-video",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate. Use @character:<id> to anchor the video to a Seedance 2 character — automatically switches to image-to-video mode. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-spicy-text-to-video-fast",
    "name": "Seedance 2 Spicy Text to Video Fast",
    "endpoint": "seedance-2-spicy-text-to-video-fast",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video to generate. Use @character:<id> to anchor the video to a Seedance 2 character — automatically switches to image-to-video mode. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "A cinematic shot of a futuristic city at night with neon lights reflecting on wet streets."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output video aspect ratio.",
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-mini-spicy-text-to-video",
    "name": "Seedance 2 Mini Spicy",
    "endpoint": "seedance-2-mini-spicy-text-to-video",
    "inputs": {
      "prompt": {
        "examples": [
          "A golden retriever running through a sunlit meadow, slow motion, vibrant summer colors, wide angle shot."
        ],
        "description": "Text prompt describing the video scene and motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output video.",
        "default": "16:9"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output video resolution.",
        "default": "720p"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "Video duration in seconds.",
        "default": 5,
        "minValue": 4,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate AI audio synchronized with the video.",
        "default": true
      },
      "high_bitrate": {
        "type": "boolean",
        "title": "High Bitrate",
        "name": "high_bitrate",
        "description": "Enable high bitrate mode for better visual fidelity. Produces larger files.",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  }
];

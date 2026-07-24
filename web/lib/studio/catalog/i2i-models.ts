/**
 * marketer.sh Studio model catalog — Image-to-image models.
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 72 models.
 */
import type { ModelDefinition } from '../types';

export const i2iModels: ModelDefinition[] = [
  {
    "id": "ai-image-upscaler",
    "name": "AI Image Upscaler",
    "endpoint": "ai-image-upscale",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-image-face-swap",
    "name": "AI Image Face Swap",
    "endpoint": "ai-image-face-swap",
    "family": "tools",
    "imageField": "image_url",
    "swapField": "swap_url",
    "hasPrompt": false,
    "inputs": {
      "target_index": {
        "type": "int",
        "title": "Target Index",
        "name": "target_index",
        "description": "0 = largest face. To switch to another target face - switch to index 1.",
        "default": 0,
        "minValue": 0,
        "maxValue": 10,
        "step": 1
      }
    },
    "provider": "muapi",
    "provider_name": "MuapiApp"
  },
  {
    "id": "ai-dress-change",
    "name": "AI Dress Change",
    "endpoint": "ai-dress-change",
    "family": "tools",
    "imageField": "model_image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-background-remover",
    "name": "AI Background Remover",
    "endpoint": "ai-background-remover",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-product-shot",
    "name": "AI Product Shot",
    "endpoint": "ai-product-shot",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "scene_description": {
        "type": "string",
        "title": "Scene Description",
        "name": "scene_description",
        "description": "Text description of the new scene or background for the provided product shot. Bria currently supports prompts in English only, excluding special characters.",
        "examples": [
          "on a rock, next to the ocean, dark theme"
        ]
      }
    },
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-skin-enhancer",
    "name": "AI Skin Enhancer",
    "endpoint": "ai-skin-enhancer",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-color-photo",
    "name": "AI Color Photo",
    "endpoint": "ai-color-photo",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "flux-kontext-dev-i2i",
    "name": "Flux Kontext Dev I2I",
    "endpoint": "flux-kontext-dev-i2i",
    "family": "kontext",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 10,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "examples": [
          "A cozy outdoor coffee shop on a small street, people sitting at tables enjoying drinks, a barista serving coffee, leaves gently falling from nearby trees, and soft warm lighting adding a friendly vibe."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9",
          "9:21"
        ],
        "default": "1:1"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "ai-product-photography",
    "name": "AI Product Photography",
    "endpoint": "ai-product-photography",
    "family": "tools",
    "imageField": "person_image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Promoting brand in professional look"
        ]
      }
    },
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-ghibli-style",
    "name": "AI Ghibli Style",
    "endpoint": "ai-ghibli-style",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-image-extension",
    "name": "AI Image Extension",
    "endpoint": "ai-image-extension",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "ai-object-eraser",
    "name": "AI Object Eraser",
    "endpoint": "ai-object-eraser",
    "family": "tools",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {},
    "provider": "muapi",
    "provider_name": "Fal"
  },
  {
    "id": "flux-kontext-pro-i2i",
    "name": "Flux Kontext Pro I2I",
    "endpoint": "flux-kontext-pro-i2i",
    "family": "kontext",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 2,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Transform into a digital painting, soft fur texture, dreamy pastel colors"
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "16:21"
        ],
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-kontext-max-i2i",
    "name": "Flux Kontext Max I2I",
    "endpoint": "flux-kontext-max-i2i",
    "family": "kontext",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 2,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Re-render in a luxury studio setting, reflective surface, high contrast shadows, ad campaign look."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "16:21"
        ],
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "gpt4o-image-to-image",
    "name": "GPT-4o Image To Image",
    "endpoint": "gpt4o-image-to-image",
    "family": "gpt",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 5,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Convert this sunny park photo into a snowy winter scene, with snow-covered trees, cloudy skies, and people in winter coats."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "2:3",
          "3:2"
        ],
        "default": "1:1"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "enum": [
          1,
          2,
          4
        ],
        "default": 1
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "gpt4o-edit",
    "name": "GPT-4o Edit",
    "endpoint": "gpt4o-edit",
    "family": "gpt",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Replace the barista with a humanoid robot in a sleek metallic design."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "2:3",
          "3:2"
        ],
        "default": "1:1"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "enum": [
          1,
          2,
          4
        ],
        "default": 1
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "midjourney-v7-image-to-image",
    "name": "Midjourney v7 Image To Image",
    "endpoint": "midjourney-v7-image-to-image",
    "family": "midjourney",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the image",
        "examples": [
          "Make the scene sunrise instead of stormy, with soft lighting and a peaceful mood"
        ]
      },
      "speed": {
        "type": "string",
        "title": "Speed",
        "name": "speed",
        "description": "The speed of which corresponds to different speed of Midjourney",
        "enum": [
          "relaxed",
          "fast",
          "turbo"
        ],
        "default": "relaxed"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "1:2",
          "2:1",
          "2:3",
          "3:2",
          "5:6",
          "6:5"
        ],
        "default": "1:1"
      },
      "variety": {
        "type": "int",
        "title": "Variety",
        "name": "variety",
        "description": "Controls the diversity of generated images. Increment by 5 each time. Higher values create more diverse results. Lower values create more consistent results.",
        "default": 5,
        "minValue": 0,
        "maxValue": 100,
        "step": 5
      },
      "stylization": {
        "type": "int",
        "title": "Stylization",
        "name": "stylization",
        "description": "Controls the artistic style intensity. Higher values create more stylized results. Lower values create more realistic results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 1000,
        "step": 1
      },
      "weirdness": {
        "type": "int",
        "title": "Weirdness",
        "name": "weirdness",
        "description": "Controls the creativity and uniqueness. Higher values create more unusual results. Lower values create more conventional results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 3000,
        "step": 1
      }
    },
    "provider": "midjourney",
    "provider_name": "Midjourney"
  },
  {
    "id": "bytedance-seededit-v3",
    "name": "Bytedance Seededit v3",
    "endpoint": "bytedance-seededit-image",
    "family": "seedream",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Change the outfit to a red evening gown with elegant styling, matching the reference image's pose and lighting."
        ]
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "midjourney-v7-style-reference",
    "name": "Midjourney v7 Style Reference",
    "endpoint": "midjourney-v7-style-reference",
    "family": "midjourney",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the image",
        "examples": [
          "A futuristic city built on waterfalls, glowing towers in the mist, colorful sky at dusk, cinematic lighting, hyper-detailed architecture."
        ]
      },
      "speed": {
        "type": "string",
        "title": "Speed",
        "name": "speed",
        "description": "The speed of which corresponds to different speed of Midjourney",
        "enum": [
          "relaxed",
          "fast",
          "turbo"
        ],
        "default": "relaxed"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "1:2",
          "2:1",
          "2:3",
          "3:2",
          "5:6",
          "6:5"
        ],
        "default": "1:1"
      },
      "variety": {
        "type": "int",
        "title": "Variety",
        "name": "variety",
        "description": "Controls the diversity of generated images. Increment by 5 each time. Higher values create more diverse results. Lower values create more consistent results.",
        "default": 5,
        "minValue": 0,
        "maxValue": 100,
        "step": 5
      },
      "stylization": {
        "type": "int",
        "title": "Stylization",
        "name": "stylization",
        "description": "Controls the artistic style intensity. Higher values create more stylized results. Lower values create more realistic results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 1000,
        "step": 1
      },
      "weirdness": {
        "type": "int",
        "title": "Weirdness",
        "name": "weirdness",
        "description": "Controls the creativity and uniqueness. Higher values create more unusual results. Lower values create more conventional results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 3000,
        "step": 1
      }
    },
    "provider": "midjourney",
    "provider_name": "Midjourney"
  },
  {
    "id": "midjourney-v7-omni-reference",
    "name": "Midjourney v7 Omni Reference",
    "endpoint": "midjourney-v7-omni-reference",
    "family": "midjourney",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the image",
        "examples": [
          "A futuristic samurai girl exploring an ancient overgrown temple in a neon-lit jungle, glowing plants surrounding her, mist in the air, cinematic composition."
        ]
      },
      "speed": {
        "type": "string",
        "title": "Speed",
        "name": "speed",
        "description": "The speed of which corresponds to different speed of Midjourney",
        "enum": [
          "relaxed",
          "fast",
          "turbo"
        ],
        "default": "relaxed"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "1:2",
          "2:1",
          "2:3",
          "3:2",
          "5:6",
          "6:5"
        ],
        "default": "1:1"
      },
      "weight": {
        "type": "int",
        "title": "Weight",
        "name": "weight",
        "description": "Weight allows you to control how much detail from your reference image appears in your new image.",
        "default": 100,
        "minValue": 1,
        "maxValue": 1000,
        "step": 1
      },
      "variety": {
        "type": "int",
        "title": "Variety",
        "name": "variety",
        "description": "Controls the diversity of generated images. Increment by 5 each time. Higher values create more diverse results. Lower values create more consistent results.",
        "default": 5,
        "minValue": 0,
        "maxValue": 100,
        "step": 5
      },
      "stylization": {
        "type": "int",
        "title": "Stylization",
        "name": "stylization",
        "description": "Controls the artistic style intensity. Higher values create more stylized results. Lower values create more realistic results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 1000,
        "step": 1
      },
      "weirdness": {
        "type": "int",
        "title": "Weirdness",
        "name": "weirdness",
        "description": "Controls the creativity and uniqueness. Higher values create more unusual results. Lower values create more conventional results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 3000,
        "step": 1
      }
    },
    "provider": "midjourney",
    "provider_name": "Midjourney"
  },
  {
    "id": "minimax-image-01-subject-reference",
    "name": "Minimax Image 01 Subject Reference",
    "endpoint": "minimax-01-subject-reference",
    "family": "minimax",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image (max 1500 characters).",
        "examples": [
          "Generate the same person dressed in Renaissance-style attire, standing in a candlelit castle hall with ornate tapestries and warm low lighting."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9"
        ],
        "default": "1:1"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "ideogram-character",
    "name": "Ideogram Character",
    "endpoint": "ideogram-character",
    "family": "ideogram",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image (max 1500 characters).",
        "examples": [
          "Create the same character as a medieval knight standing in a candlelit castle corridor, wearing chainmail and holding a torch."
        ]
      },
      "render_speed": {
        "type": "string",
        "title": "Render Speed",
        "name": "render_speed",
        "description": "The rendering speed to use.",
        "enum": [
          "Turbo",
          "Balanced",
          "Quality"
        ],
        "default": "Balanced"
      },
      "style": {
        "type": "string",
        "title": "Style",
        "name": "style",
        "description": "The style type to generate with.",
        "enum": [
          "Auto",
          "Realistic",
          "Fiction"
        ],
        "default": "Auto"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "1:1"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "ideogram",
    "provider_name": "Ideogram"
  },
  {
    "id": "flux-pulid",
    "name": "Flux Pulid",
    "endpoint": "flux-pulid",
    "family": "flux",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image (max 1500 characters).",
        "examples": [
          "Recreate the same person in a Renaissance-style painting with ornate collar and soft candlelight ambiance."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "qwen-image-edit",
    "name": "Qwen Image Edit",
    "endpoint": "qwen-image-edit",
    "family": "qwen",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Replace the field with a snowy mountain landscape."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "9:21",
          "3:2",
          "2:3"
        ],
        "default": "1:1"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "image-effects",
    "name": "Image Effects",
    "endpoint": "image-effects",
    "family": "effects",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "name": {
        "type": "string",
        "title": "Effect Name",
        "name": "name",
        "description": "The type of effect to apply to the image.",
        "enum": [
          "Acryclic Ornaments",
          "Advanced Photography",
          "American Comic Style",
          "Angel Figurine",
          "Blurry Selfie",
          "Cyberpunk",
          "Exotic Charm",
          "Felt 3D Polaroid",
          "Felt Keychain",
          "Furry Dream Doll",
          "Futuristic American Comics",
          "Glass Ball",
          "In The Stadium",
          "Lofi Pixel Character",
          "Lying On Fluffy Belly",
          "Landscape Mini World",
          "My World",
          "Plastic Bubble Figure"
        ],
        "default": "Angel Figurine"
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "nano-banana-edit",
    "name": "Nano Banana Edit",
    "endpoint": "nano-banana-edit",
    "family": "nano",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 10,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Change her facial expression to a confident smile, and adjust the lighting to dramatic blue and purple hues. Keep her hairstyle and outfit consistent across multiple edits."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "Auto",
          "1:1",
          "3:4",
          "4:3",
          "9:16",
          "16:9",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
          "21:9"
        ],
        "default": "Auto"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "ideogram-v3-reframe",
    "name": "Ideogram v3 Reframe",
    "endpoint": "ideogram-v3-reframe",
    "family": "ideogram",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "1:1"
      },
      "render_speed": {
        "type": "string",
        "title": "Render Speed",
        "name": "render_speed",
        "description": "The rendering speed to use.",
        "enum": [
          "Turbo",
          "Balanced",
          "Quality"
        ],
        "default": "Balanced"
      },
      "style": {
        "type": "string",
        "title": "Style",
        "name": "style",
        "description": "The style type to generate with.",
        "enum": [
          "Auto",
          "General",
          "Realistic",
          "Design"
        ],
        "default": "Auto"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "ideogram",
    "provider_name": "Ideogram"
  },
  {
    "id": "bytedance-seedream-edit-v4",
    "name": "Bytedance Seedream Edit v4",
    "endpoint": "bytedance-seedream-edit-v4",
    "family": "seedream",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 10,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "A tranquil shoreline at dawn where waves turn into glowing ribbons of light, painting the sky with dreamlike hues of violet and gold. A figure walks along the edge, leaving footsteps that bloom into luminous flowers, symbolizing imagination flowing seamlessly into reality."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "2:3",
          "3:2",
          "21:9"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "Resolution of the output image.",
        "enum": [
          "1K",
          "2K",
          "4K"
        ],
        "default": "4K"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "nano-banana-effects",
    "name": "Nano Banana Effects",
    "endpoint": "nano-banana-effects",
    "family": "nano",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "name": {
        "type": "string",
        "title": "Effect Name",
        "name": "name",
        "description": "The type of effect to apply to the image.",
        "enum": [
          "3D Figurine",
          "16bit Game Character",
          "1920s Decade",
          "1950s Decade",
          "1970s Decade",
          "1980s Decade",
          "Action Figure",
          "American Gothic Art",
          "Egypts Landmark",
          "Eiffel Tower Landmark",
          "Famous Art",
          "Great Wall of China Landmark",
          "Mona Lisa Art",
          "Persistent Memory Art",
          "Statue of Liberty Landmark",
          "Taj Mahal Landmark",
          "Vincent Van Gogh Art"
        ],
        "default": "3D Figurine"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "Auto",
          "1:1",
          "3:4",
          "4:3",
          "9:16",
          "16:9",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
          "21:9"
        ],
        "default": "Auto"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "flux-kontext-effects",
    "name": "Flux Kontext Effects",
    "endpoint": "flux-kontext-effects",
    "family": "kontext",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "20 years older"
        ]
      },
      "name": {
        "type": "string",
        "title": "Effect Name",
        "name": "name",
        "description": "The type of effect to apply to the image.",
        "enum": [
          "Age Progression",
          "Background Change",
          "Cartoonify",
          "Color Correction",
          "Expression Change",
          "Face Enhancement",
          "Hair Change",
          "Object Removal",
          "Professional Photo",
          "Scene Composition",
          "Style Transfer",
          "Time of Day",
          "Weather Effect"
        ],
        "default": "Age Progression"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-redux",
    "name": "Flux Redux",
    "endpoint": "flux-redux",
    "family": "flux",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image (max 1500 characters).",
        "examples": [
          "Reimagine the forest cabin as a mystical fantasy retreat at twilight, glowing lanterns hanging from the trees, magical fireflies in the air, cinematic atmosphere with enchanted vibes."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9",
          "9:21"
        ],
        "default": "1:1"
      },
      "num_images": {
        "type": "int",
        "title": "Number of images",
        "name": "num_images",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "qwen-image-edit-plus",
    "name": "Qwen Image Edit Plus",
    "endpoint": "qwen-image-edit-plus",
    "family": "qwen",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 3,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Replace the watch strap with a rich brown leather band, add subtle engravings on the bezel, increase the contrast slightly, and warm the overall lighting to golden-hour tones, keeping reflections realistic."
        ]
      },
      "width": {
        "type": "int",
        "title": "Width",
        "name": "width",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "type": "int",
        "title": "Height",
        "name": "height",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.5-image-edit",
    "name": "Wan2.5 Image Edit",
    "endpoint": "wan2.5-image-edit",
    "family": "wan2.5",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 2,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Reimagine the scene under a raging thunderstorm at night: lightning forks across the sky, illuminating the samurai in stark flashes of white light."
        ]
      },
      "width": {
        "type": "int",
        "title": "Width",
        "name": "width",
        "description": "Width of the output image.",
        "default": 2048,
        "minValue": 384,
        "maxValue": 5000,
        "step": 1
      },
      "height": {
        "type": "int",
        "title": "Height",
        "name": "height",
        "description": "Height of the output image.",
        "default": 2048,
        "minValue": 384,
        "maxValue": 5000,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "reve-image-edit",
    "name": "Reve Image Edit",
    "endpoint": "reve-image-edit",
    "family": "reve",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "A photorealistic fantasy portrait, transforming the woman in the image into an elegant high elf. Give her long, gracefully pointed ears that peek through her hair. Her skin has a subtle, ethereal glow. Replace her white blazer and necklaces with ornate, flowing elven robes made of shimmering silver fabric and intricate leaf patterns. The background is a mystical, twilight forest with glowing magical flora. **CRITICAL:** Maintain her exact original pose, serene smiling expression, and facial structure. Cinematic lighting, masterpiece, hyper-detailed."
        ]
      }
    },
    "provider": "reve",
    "provider_name": "Reve"
  },
  {
    "id": "topaz-image-upscale",
    "name": "Topaz Image Upscale",
    "endpoint": "topaz-image-upscale",
    "family": "topaz",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "upscale_factor": {
        "type": "string",
        "title": "Upscale Factor",
        "name": "upscale_factor",
        "description": "Factor to upscale the image by (e.g. 2.0 doubles width and height).",
        "enum": [
          1,
          2,
          4,
          8
        ],
        "default": 2
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "seedvr2-image-upscale",
    "name": "Seedvr2 Image Upscale",
    "endpoint": "seedvr2-image-upscale",
    "family": "seedvr2",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "2k",
          "4k",
          "8k"
        ],
        "default": "4k"
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "qwen-image-edit-plus-lora",
    "name": "Qwen Image Edit Plus Lora",
    "endpoint": "qwen-image-edit-plus-lora",
    "family": "qwen",
    "imageField": "images_list",
    "hasPrompt": false,
    "maxImages": 3,
    "inputs": {
      "rotate_right_left": {
        "type": "int",
        "title": "Rotate Right-Left (degrees°)",
        "name": "rotate_right_left",
        "description": "Rotate camera left (positive) or right (negative) in degrees. Positive values rotate left, negative values rotate right.",
        "default": 0,
        "minValue": -90,
        "maxValue": 90,
        "step": 1
      },
      "move_forward": {
        "type": "int",
        "title": "Move Forward → Close-Up",
        "name": "move_forward",
        "description": "Move camera forward (0=no movement, 10=close-up)",
        "default": 0,
        "minValue": 0,
        "maxValue": 10,
        "step": 0.1
      },
      "vertical_angle": {
        "type": "int",
        "title": "Vertical Angle (Bird ⬄ Worm)",
        "name": "vertical_angle",
        "description": "Adjust vertical camera angle (-1=bird's eye view/looking down, 0=neutral, 1=worm's-eye view/looking up)",
        "default": 0,
        "minValue": -1,
        "maxValue": 1,
        "step": 0.1
      },
      "wide_angle_lens": {
        "type": "boolean",
        "title": "Wide-Angle Lens",
        "name": "wide_angle_lens",
        "description": "Enable wide-angle lens effect",
        "default": false
      },
      "width": {
        "type": "int",
        "title": "Width",
        "name": "width",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "type": "int",
        "title": "Height",
        "name": "height",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "nano-banana-pro-edit",
    "name": "Nano Banana Pro Edit",
    "endpoint": "nano-banana-pro-edit",
    "family": "nano",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 8,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Keep the same scene and subject, but change the lighting to warm golden sunset tones, remove the neon signs, add soft sunlight beams from the side, enhance surface details, keep reflections subtle and natural."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "3:4",
          "4:3",
          "9:16",
          "16:9",
          "3:2",
          "2:3",
          "5:4",
          "4:5",
          "21:9"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "1k",
          "2k",
          "4k"
        ],
        "default": "1k"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "image-passthrough",
    "name": "Image Passthrough",
    "endpoint": "image-passthrough",
    "family": "image",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "make_input": {
        "type": "boolean",
        "title": "Make Input",
        "name": "make_input",
        "default": true
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "kling-o1-edit-image",
    "name": "Kling O1 Edit Image",
    "endpoint": "kling-o1-edit-image",
    "family": "kling-o1",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 10,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Replace the hanging lanterns with floating bioluminescent orbs that emit soft cyan light, keep the garden composition and city reflections unchanged, ensure the orbs cast subtle cyan rim-light on nearby leaves and glass, preserve overall twilight mood and depth of field."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "auto",
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "2:3",
          "3:2",
          "21:9"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "1k",
          "2k"
        ],
        "default": "1k"
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "flux-2-dev-edit",
    "name": "Flux 2 Dev Edit",
    "endpoint": "flux-2-dev-edit",
    "family": "flux-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 3,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Replace the floating stained-glass cathedral with a colossal crystal tree glowing from within, while keeping the stormy sky, ocean waves, rainbow reflections, and dramatic lighting intact."
        ]
      },
      "width": {
        "type": "int",
        "title": "Width",
        "name": "width",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "type": "int",
        "title": "Height",
        "name": "height",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-2-flex-edit",
    "name": "Flux 2 Flex Edit",
    "endpoint": "flux-2-flex-edit",
    "family": "flux-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 8,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Replace the molten gold in the lower chamber with a swirling vortex of glowing sapphire mist, keep the crystal panels, star map, orbiting metallic rings, and aurora sky unchanged, ensure the new mist casts cool blue highlights and interacts naturally with the surrounding lightning."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "auto",
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "2:3",
          "3:2"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "1k",
          "2k"
        ],
        "default": "1k"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-2-pro-edit",
    "name": "Flux 2 Pro Edit",
    "endpoint": "flux-2-pro-edit",
    "family": "flux-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 8,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Replace the central spherical chronometer with a floating crystalline lotus emitting soft golden light, keep the asteroid chamber, star charts, cosmic dust streams, and prismatic beams unchanged, ensure the lotus casts warm highlights and seamlessly integrates with the scene’s lighting."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "auto",
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "2:3",
          "3:2"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "1k",
          "2k"
        ],
        "default": "1k"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "vidu-q2-reference-to-image",
    "name": "Vidu Q2 Reference To Image",
    "endpoint": "vidu-q2-reference-to-image",
    "family": "vidu-q2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 7,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Create a new scene where the masked wanderer stands inside an ancient stone observatory illuminated by rotating celestial beams; preserve the character’s clothing style and silhouette while adding glowing runes carved into the walls, mist swirling across the floor, and a dramatic cosmic light shaft from above; cinematic composition, high detail."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "auto",
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "2:3",
          "3:2",
          "21:9"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "1k",
          "2k",
          "4k"
        ],
        "default": "1k"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "bytedance-seedream-v4.5-edit",
    "name": "Bytedance Seedream v4.5 Edit",
    "endpoint": "bytedance-seedream-v4.5-edit",
    "family": "seedream-v45",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 10,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Replace the glowing amethyst flame at the tower’s peak with a levitating orb of swirling turquoise water, keeping the spiral tower, crystalline desert, floating shards, and aurora-lit sky unchanged; ensure the water orb emits cool reflections and integrates naturally with the existing lighting."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "2:3",
          "3:2",
          "21:9"
        ],
        "default": "1:1"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "Quality of the output image.",
        "enum": [
          "basic",
          "high"
        ],
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "qwen-image-edit-2511",
    "name": "Qwen Image Edit 2511",
    "endpoint": "qwen-image-edit-2511",
    "family": "qwen",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 3,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Replace the glass observatory with a floating bronze astrolabe composed of interlocking rings and engraved symbols, keep the glowing desert, dusk sky, dust trails, and lighting unchanged; ensure the bronze surface reflects the warm sunset tones naturally and integrates seamlessly with the scene."
        ]
      },
      "width": {
        "type": "integer",
        "title": "Width",
        "name": "width",
        "description": "Width of the image in pixels",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "type": "integer",
        "title": "Height",
        "name": "height",
        "description": "Height of the image in pixels",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.6-image-edit",
    "name": "Wan2.6 Image Edit",
    "endpoint": "wan2.6-image-edit",
    "family": "wan2.6",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 3,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Replace the glowing crystal spires with towering living trees made of luminous jade leaves and silver bark, keep the floating citadel structure, ocean reflections, mist, moonlight, and twilight color palette unchanged; ensure the new trees cast soft green highlights that blend naturally with the existing lighting."
        ]
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "qwen-text-to-image-2512",
    "name": "Qwen Text To Image 2512",
    "endpoint": "qwen-text-to-image-2512",
    "family": "qwen",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "A colossal biomechanical whale swimming slowly through a vast sky made of soft clouds and fractured light. Its translucent body reveals glowing internal organs shaped like rotating gears and flowing energy veins. Below it, a sprawling patchwork of farmland and rivers curves with the planet’s surface, catching reflections from the whale’s luminous glow. Long fabric banners trail from the whale’s fins, fluttering gently in the wind like ceremonial streamers. The camera angle is wide and aerial, emphasizing scale and serenity. Soft sunrise colors, cinematic depth, ultra-detailed surreal sci-fi atmosphere."
        ]
      },
      "width": {
        "type": "integer",
        "title": "Width",
        "name": "width",
        "description": "Width of the image in pixels",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "type": "integer",
        "title": "Height",
        "name": "height",
        "description": "Height of the image in pixels",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "gpt-image-2-edit",
    "name": "Gpt Image 2 Edit",
    "endpoint": "gpt-image-2-image-to-image",
    "family": "gpt-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 16,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the transformation. Up to 20,000 characters supported.",
        "examples": [
          "Transform these product photos into a professional lifestyle scene with warm cinematic lighting, soft natural shadows, and a clean modern background; keep brand details and proportions unchanged."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "auto",
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "default": "auto"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The target resolution of the generated image.",
        "enum": [
          "1K",
          "2K",
          "4K"
        ],
        "default": "2K"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "gpt-image-1.5-edit",
    "name": "Gpt Image 1.5 Edit",
    "endpoint": "gpt-image-1.5-edit",
    "family": "gpt-1.5",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 10,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt for edit image.",
        "examples": [
          "Replace the abandoned car with a sleek autonomous electric vehicle made of brushed metal and soft glowing panels, keep the desert highway, sunset lighting, heat distortion, power lines, and approaching storm unchanged; ensure reflections and shadows match the original environment naturally."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output image.",
        "enum": [
          "1:1",
          "2:3",
          "3:2"
        ],
        "default": "1:1"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "The quality of the generated image.",
        "enum": [
          "low",
          "medium",
          "high"
        ],
        "default": "medium"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "grok-imagine-image-to-image",
    "name": "Grok Imagine Image To Image",
    "endpoint": "grok-imagine-image-to-image",
    "family": "grok",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image.",
        "examples": [
          "Replace the arriving train with a silent magnetic levitation transit pod made of matte white composite and glass, keep the platform, people, lighting, reflections, and urban environment unchanged; ensure the new vehicle fits naturally into the scene with correct scale, shadows, and motion blur."
        ]
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "Api Node",
    "name": "Api Node",
    "endpoint": "Api Node",
    "family": "wavespeed",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "model_url": {
        "type": "string",
        "title": "Model URL",
        "name": "model_url",
        "description": "Url of the wavespeed model",
        "examples": [
          ""
        ]
      },
      "api_key": {
        "type": "string",
        "title": "API Key",
        "name": "api_key",
        "description": "API key for authentication",
        "examples": [
          ""
        ]
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "flux-2-klein-4b-edit",
    "name": "Flux 2 Klein 4b Edit",
    "endpoint": "flux-2-klein-4b-edit",
    "family": "flux-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 4,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Add a tiny blue knitted scarf around the kitten’s neck, keep the kitten’s pose, table, lighting, and cozy indoor environment unchanged; make the scarf soft and cute, fitting naturally without covering the kitten’s face."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated image",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9",
          "9:21"
        ],
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-2-klein-9b-edit",
    "name": "Flux 2 Klein 9b Edit",
    "endpoint": "flux-2-klein-9b-edit",
    "family": "flux-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 4,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "examples": [
          "Add a small red bow tie around the puppy’s neck, slightly fluffy fabric texture, keep the puppy’s pose, facial expression, sofa, lighting, and living room environment unchanged; ensure the bow tie matches the warm lighting and looks naturally placed."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated image",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9",
          "9:21"
        ],
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "add-image-watermark",
    "name": "Add Image Watermark",
    "endpoint": "add-image-watermark",
    "family": "watermark",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "position": {
        "type": "string",
        "title": "Position",
        "name": "position",
        "description": "Position of the watermark on the image",
        "enum": [
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
          "center"
        ],
        "default": "bottom-right"
      },
      "opacity": {
        "type": "number",
        "title": "Opacity",
        "name": "opacity",
        "description": "Watermark transparency (0 = invisible, 1 = fully opaque)",
        "default": 0.7
      },
      "scale": {
        "type": "number",
        "title": "Scale",
        "name": "scale",
        "description": "Watermark size relative to image (0.1 = 10%, 1.0 = 100%)",
        "default": 0.2
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "nano-banana-2-edit",
    "name": "Nano Banana 2 Edit",
    "endpoint": "nano-banana-2-edit",
    "family": "nano",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 14,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Positive prompt for generation.",
        "examples": [
          "Transform the portrait into a cyberpunk style with neon lighting, metallic accessories, and a rain-soaked city background, maintaining the subject's facial features."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "1:4",
          "1:8",
          "2:3",
          "3:2",
          "3:4",
          "4:1",
          "4:3",
          "4:5",
          "5:4",
          "8:1",
          "9:16",
          "16:9",
          "21:9",
          "auto"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated image.",
        "default": "auto"
      },
      "resolution": {
        "enum": [
          "1k",
          "2k",
          "4k"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The resolution of the generated image.",
        "default": "1k"
      },
      "google_search": {
        "title": "Google Search",
        "name": "google_search",
        "type": "boolean",
        "description": "Whether to use Google Search for prompt enhancement.",
        "default": false
      },
      "output_format": {
        "enum": [
          "jpg",
          "png"
        ],
        "title": "Output Format",
        "name": "output_format",
        "type": "string",
        "description": "The format of the output image.",
        "default": "jpg"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "seedream-5.0-edit",
    "name": "Seedream 5.0 Edit",
    "endpoint": "seedream-5.0-edit",
    "family": "seedream",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired modification.",
        "examples": [
          "Change the daytime forest scene to a moonlit winter landscape with shimmering snow on the trees and a soft blue glow from a distant cottage window."
        ]
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "2:3",
          "3:2",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "quality": {
        "enum": [
          "basic",
          "high"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "Quality of the output image.",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  }
,
  {
    "id": "bytedance-seedream-v4-edit",
    "name": "Seedream 4 Edit",
    "endpoint": "bytedance-seedream-edit-v4",
    "inputs": {
      "prompt": {
        "examples": [
          "A tranquil shoreline at dawn where waves turn into glowing ribbons of light, painting the sky with dreamlike hues of violet and gold. A figure walks along the edge, leaving footsteps that bloom into luminous flowers, symbolizing imagination flowing seamlessly into reality."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedream-v4-edit-input.jpg"
        ],
        "description": "Upload or provide reference images. Used for image-to-image generation.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 10
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "2:3",
          "3:2",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "resolution": {
        "enum": [
          "1K",
          "2K",
          "4K"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Resolution of the output image.",
        "default": "4K"
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "bytedance-seedream-v5.0-edit",
    "name": "Seedream 5.0 Edit",
    "endpoint": "seedream-5.0-edit",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired modification",
        "examples": [
          "Replace the plain transparent screen with a futuristic holographic display, making the screen emit a brighter cyan and purple glow. Transform the text “Seedream 5.0 Lite Edit” into large 3D glowing neon letters with depth, reflections, and soft bloom lighting.\n\nAdd animated editing UI elements such as floating anchor points, bezier curves, bounding boxes, and adjustment handles around the text, clearly visible and luminous.\n\nChange the environment lighting to a darker, high-contrast tech room so the glowing text becomes the dominant focal point. Add subtle volumetric light beams and floor reflections directly beneath the text.\n\nKeep the same camera angle and composition, but make the result look like a premium futuristic editing interface poster, with the text clearly highlighted and visually powerful."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedream-5.0-edit-in.jpg"
        ],
        "description": "Upload or provide start frame image. Used for image-to-video generation.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 14
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "2:3",
          "3:2",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "quality": {
        "enum": [
          "basic",
          "high"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "Quality of the output image.",
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "qwen-image-2.0-edit",
    "name": "Qwen Image 2.0 Edit",
    "endpoint": "qwen-image-2.0-edit",
    "inputs": {
      "prompt": {
        "description": "A description of the edits you want to make.",
        "title": "Prompt",
        "type": "string",
        "name": "prompt",
        "examples": [
          "Turn the coffee cup into a miniature volcano where the coffee erupts like lava and smoke rises dramatically from the cup."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/qwen-image-2.0-edit-in.jpg"
        ],
        "description": "Upload up to 9 image URLs.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "type": "string",
        "name": "aspect_ratio",
        "default": "16:9",
        "description": "Aspect ratio of the output image."
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "qwen-image-2.0-pro-edit",
    "name": "Qwen Image 2.0 Pro Edit",
    "endpoint": "qwen-image-2.0-pro-edit",
    "inputs": {
      "prompt": {
        "description": "A description of the edits you want to make.",
        "title": "Prompt",
        "type": "string",
        "name": "prompt",
        "examples": [
          "Transform the office into a dense tropical jungle with vines covering the desks, plants growing through the floor, and sunlight beams shining through broken ceiling panels."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/qwen-image-2.0-pro-edit-in.jpg"
        ],
        "description": "Upload up to 6 image URLs.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 6
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
        "type": "string",
        "name": "aspect_ratio",
        "default": "16:9",
        "description": "The aspect ratio of the generated image."
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "flux-2-klein-4b-turbo-edit",
    "name": "Flux 2 Klein 4B Turbo Edit",
    "endpoint": "flux-2-klein-4b-turbo-edit",
    "inputs": {
      "prompt": {
        "examples": [
          "Add a tiny blue knitted scarf around the kitten’s neck."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/flux-2-klein-4b-edit-in.jpg"
        ],
        "description": "List of URLs of input images for editing.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 4
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated image",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-2-klein-9b-turbo-edit",
    "name": "Flux 2 Klein 9B Turbo Edit",
    "endpoint": "flux-2-klein-9b-turbo-edit",
    "inputs": {
      "prompt": {
        "examples": [
          "Add a small red bow tie around the puppy’s neck."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/flux-2-klein-9b-edit-in.jpg"
        ],
        "description": "List of URLs of input images for editing.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 4
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated image",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "portrait-stylist",
    "name": "AI Portrait Stylist",
    "endpoint": "portrait-stylist",
    "inputs": {
      "image_url": {
        "type": "string",
        "name": "image_url",
        "title": "Image URL",
        "description": "Upload a clear portrait photo.",
        "field": "image",
        "examples": [
          "https://cdn.muapi.ai/outputs/d09a771a8b2a45f1b0b5e6aba5955f1b.jpg"
        ]
      },
      "name": {
        "type": "string",
        "title": "Name",
        "name": "name",
        "description": "Select the portrait effect to apply.",
        "enum": [
          "Voluminous Frizzy Hair",
          "Platinum Blonde Hair",
          "Deep Burgundy Hair",
          "Jet Black Hair",
          "Bold Hair Highlights",
          "Bold Red Lipstick",
          "Smokey Eye Makeup",
          "Glossy Nude Makeup",
          "Winged Eyeliner",
          "Party Glam Makeup",
          "Aviator Sunglasses",
          "Oversized Sunglasses",
          "Modern Transparent Glasses",
          "Bold Fashion Hat",
          "Bright Pink Outfit",
          "Black Leather Jacket",
          "White Formal Shirt",
          "Neon Green Hoodie",
          "Cinematic Lighting",
          "Cyberpunk Lighting"
        ],
        "default": "Voluminous Frizzy Hair"
      },
      "aspect_ratio": {
        "type": "string",
        "name": "aspect_ratio",
        "title": "Aspect Ratio",
        "description": "Output aspect ratio.",
        "enum": [
          "auto",
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16"
        ],
        "default": "auto"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "seedance-2-character",
    "name": "Seedance 2 Character",
    "endpoint": "seedance-2-character",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Outfit Description",
        "name": "prompt",
        "description": "Describe the outfit or costume the character should wear.",
        "examples": [
          "A red leather jacket with black jeans and white sneakers"
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/956660418681/1b84d57d-0869-40f7-8ceb-85ea38074022.jpg"
        ],
        "description": "1–3 reference photos of the character to build the sheet from.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 3
      },
      "character_name": {
        "type": "string",
        "format": "text",
        "title": "Character Name",
        "name": "character_name",
        "description": "Optional label to identify this character.",
        "examples": [
          "A Hero"
        ]
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "wan2.7-image-edit",
    "name": "Wan 2.7 Image Edit",
    "endpoint": "wan2.7-image-edit",
    "inputs": {
      "prompt": {
        "examples": [
          "Turn the dog into a royal king sitting on a throne, wearing a crown and luxurious robes, dramatic golden lighting."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/wan2.7-image-edit-in.jpg"
        ],
        "description": "Upload or provide the input image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URL",
        "name": "images_list",
        "maxItems": 9
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated image",
        "default": "1:1",
        "enum": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "21:9",
          "9:21",
          "3:2",
          "2:3"
        ]
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.7-image-edit-pro",
    "name": "Wan 2.7 Image Edit Pro",
    "endpoint": "wan2.7-image-edit-pro",
    "inputs": {
      "prompt": {
        "examples": [
          "Convert the entire scene into an underwater environment where the buildings are covered in coral, fish swim through the streets, and light rays pass through the water."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/wan2.7-image-edit-pro-in.jpg"
        ],
        "description": "Upload or provide the input image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URL",
        "name": "images_list",
        "maxItems": 9
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated image",
        "default": "1:1",
        "enum": [
          "1:1",
          "4:3",
          "3:4",
          "16:9",
          "9:16",
          "21:9",
          "9:21",
          "3:2",
          "2:3"
        ]
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "flux-2-klein-4b-edit-lora",
    "name": "Flux 2 Klein 4B Edit LoRA",
    "endpoint": "flux-2-klein-4b-edit-lora",
    "inputs": {
      "prompt": {
        "examples": [
          "Add a tiny blue knitted scarf around the kitten's neck, keep pose, lighting, and background unchanged."
        ],
        "description": "Editing instruction describing the desired change.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/flux-2-klein-4b-edit-in.jpg"
        ],
        "description": "List of 1-3 reference image URLs to edit.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 3
      },
      "lora_list": {
        "examples": [
          {
            "path": "https://huggingface.co/example/lora/resolve/main/lora.safetensors",
            "scale": 1
          }
        ],
        "title": "LoRA List",
        "name": "lora_list",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "format": "url",
              "title": "Path",
              "name": "path",
              "description": "URL or path to the LoRA weights."
            },
            "scale": {
              "type": "number",
              "title": "Scale",
              "name": "scale",
              "description": "The LoRA weight multiplier. Default value: 1",
              "minValue": 0,
              "maxValue": 4,
              "step": 0.01,
              "default": 1
            }
          }
        },
        "description": "Up to 3 LoRA adapters to apply during the edit.",
        "maxItems": 3
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated image",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-2-klein-9b-edit-lora",
    "name": "Flux 2 Klein 9B Edit LoRA",
    "endpoint": "flux-2-klein-9b-edit-lora",
    "inputs": {
      "prompt": {
        "examples": [
          "Add ornate gold filigree to the costume while preserving the pose, lighting, and background scene."
        ],
        "description": "Editing instruction describing the desired change.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/flux-2-klein-9b-edit-in.jpg"
        ],
        "description": "List of 1-3 reference image URLs to edit.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 3
      },
      "lora_list": {
        "examples": [
          {
            "path": "https://huggingface.co/example/lora/resolve/main/lora.safetensors",
            "scale": 1
          }
        ],
        "title": "LoRA List",
        "name": "lora_list",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "format": "url",
              "title": "Path",
              "name": "path",
              "description": "URL or path to the LoRA weights."
            },
            "scale": {
              "type": "number",
              "title": "Scale",
              "name": "scale",
              "description": "The LoRA weight multiplier. Default value: 1",
              "minValue": 0,
              "maxValue": 4,
              "step": 0.01,
              "default": 1
            }
          }
        },
        "description": "Up to 3 LoRA adapters to apply during the edit.",
        "maxItems": 3
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated image",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "kling-o3-image-edit",
    "name": "Kling O3 Image Edit",
    "endpoint": "kling-o3-image-edit",
    "inputs": {
      "prompt": {
        "examples": [
          "Preserve the original composition, people placements, facial identities, DJ setup, and rooftop party mood from the source image. Transform the entire scene into a tiny miniature rooftop party built on top of a moving RC toy truck driving across a messy apartment floor. Surround the tiny party with giant everyday household objects like shoes, cables, snack packets, books, and soda cans towering like skyscrapers. Keep the same party energy and realistic interactions while introducing playful scale contrast, macro photography depth, cinematic lighting, and highly detailed miniature-world realism."
        ],
        "description": "Text instructions describing the desired transformation. Maximum 2,000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/kling-o3-image-edit-in.jpg"
        ],
        "description": "Upload or provide reference images to transform. Up to 10 images supported.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 10
      },
      "aspect_ratio": {
        "enum": [
          "auto",
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "3:2",
          "2:3",
          "21:9"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output image aspect ratio. Use 'auto' to follow the reference image.",
        "default": "auto"
      },
      "resolution": {
        "enum": [
          "1K",
          "2K",
          "4K"
        ],
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "Output image resolution.",
        "default": "1K"
      },
      "num_images": {
        "type": "int",
        "title": "Number of Images",
        "name": "num_images",
        "description": "How many images to generate per request.",
        "default": 1,
        "minValue": 1,
        "maxValue": 9,
        "step": 1
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "nano-banana-2-lite-edit",
    "name": "Nano Banana 2 Lite Edit",
    "endpoint": "nano-banana-2-lite-edit",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired image content.",
        "examples": [
          "Transform the cat into a cosmic creature made of stars, nebula clouds, and glowing galaxies while preserving its sitting pose and facial expression. Add orbiting miniature planets around its body."
        ]
      },
      "images_list": {
        "examples": [
          "https://cdn.muapi.ai/assets/nano-banana-2-lite-edit-in.jpg"
        ],
        "description": "Reference image URLs to edit. Up to 14 images.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 14
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "The aspect ratio of the generated image.",
        "default": "1:1"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "bytedance-seedream-5.0-pro-edit",
    "name": "Seedream 5.0 Pro Edit",
    "endpoint": "seedream-5.0-pro-edit",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired modification",
        "examples": [
          "Keep the model's pose and the flowing shape of the liquid dress unchanged. Change the clothing material from silver metal to completely transparent clear water. Lighting changes from reflection to refraction."
        ]
      },
      "images_list": {
        "examples": [
          "https://static.aiquickdraw.com/tools/example/1764851484363_ScV1s2aq.webp"
        ],
        "description": "One or more reference image URLs to edit.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 10
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image. 16:9 and 9:16 do not support 2K resolution.",
        "default": "1:1"
      },
      "resolution": {
        "enum": [
          "1K",
          "2K"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "Output image resolution.",
        "default": "1K"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  }
];

/**
 * marketer.sh Studio model catalog — Text-to-image models.
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 70 models.
 */
import type { ModelDefinition } from '../types';

export const t2iModels: ModelDefinition[] = [
  {
    "id": "nano-banana",
    "name": "Nano Banana",
    "endpoint": "nano-banana",
    "inputs": {
      "prompt": {
        "examples": [
          "A portrait of me in a modern living room. Change it so I’m dressed in 1950s attire with a polka-dot dress, while maintaining my face and hairstyle."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "flux-dev",
    "name": "Flux Dev",
    "endpoint": "flux-dev-image",
    "inputs": {
      "prompt": {
        "examples": [
          "Extreme close-up of a single tiger eye, direct frontal view. Detailed iris and pupil. Sharp focus on eye texture and color. Natural lighting to capture authentic eye shine and depth. The word \"FLUX\" is painted over it in big, white brush strokes with visible texture."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
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
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-dev-lora",
    "name": "Flux Dev Lora",
    "inputs": {
      "prompt": {
        "examples": [
          "A female warrior in ornate armor standing on a cliff during sunset, flowing cape, wind blowing through her hair, detailed fantasy art style."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "model_id": {
        "examples": [
          {
            "model": "civitai:119351@317153",
            "weight": 1
          }
        ],
        "title": "LoRA Ids",
        "name": "model_id",
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "model": {
              "type": "string",
              "format": "url",
              "title": "Model ID",
              "description": "The Civitai LoRA model ID."
            },
            "weight": {
              "type": "number",
              "title": "Weight",
              "description": "A list of LoRA models to use for generation. Each item must include an `id` (e.g., \"civitai:1642876@1864626\") and a `weight` between 0 and 4. You can include up to 4 models. The `id` can be found in the Civitai model URL. These models will be applied with the specified weights by the Flux Dev system during image generation.",
              "minValue": 0,
              "maxValue": 4,
              "step": 0.01,
              "default": 1
            }
          }
        },
        "description": "The unique identifier of a LoRA model hosted on Civitai, used by the Flux Dev image generation system. This ID tells Flux Dev which specific LoRA model to apply during generation. You can find the model ID in the Civitai model URL (e.g., model_id: civitai:1642876@1864626).",
        "maxItems": 4
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64,
        "isEdit": true
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64,
        "isEdit": true
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1,
        "isEdit": true
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-kontext-dev-t2i",
    "name": "Flux Kontext Dev T2I",
    "inputs": {
      "prompt": {
        "examples": [
          "A powerful wizard casting a glowing spell in a dark forest, wearing a hooded robe, with swirling magical energy, epic fantasy art."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1,
        "isEdit": true
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "hidream-i1-fast",
    "name": "Hidream I1 Fast",
    "inputs": {
      "prompt": {
        "examples": [
          "A colorful cartoon-style cat sitting on a skateboard, wide smile, playful background, 2D flat illustration style."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
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
    "provider": "hidream",
    "provider_name": "Hidream"
  },
  {
    "id": "hidream-i1-dev",
    "name": "Hidream I1 Dev",
    "inputs": {
      "prompt": {
        "examples": [
          "A colorful cartoon-style cat sitting on a skateboard, wide smile, playful background, 2D flat illustration style."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
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
    "provider": "hidream",
    "provider_name": "Hidream"
  },
  {
    "id": "hidream-i1-full",
    "name": "Hidream I1 Full",
    "inputs": {
      "prompt": {
        "examples": [
          "A majestic elven queen standing in a glowing forest, wearing intricate golden armor with emerald details, sunlight rays filtering through the trees, ultra-detailed fantasy concept art."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
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
    "provider": "hidream",
    "provider_name": "Hidream"
  },
  {
    "id": "ai-anime-generator",
    "name": "Ai Anime Generator",
    "inputs": {
      "prompt": {
        "examples": [
          "A cheerful anime girl with short pink hair and green eyes, wearing a school uniform, standing under cherry blossom trees, soft lighting, anime style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1,
        "isEdit": true
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1,
        "isEdit": true
      }
    },
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "wan2.1-text-to-image",
    "name": "Wan2.1 Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A young woman with freckles and natural makeup, standing in soft sunlight, sharp focus, DSLR photo style, ultra-realistic skin texture."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
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
    "id": "flux-kontext-pro-t2i",
    "name": "Flux Kontext Pro T2I",
    "inputs": {
      "prompt": {
        "examples": [
          "A steampunk owl with mechanical wings, perched on a glowing gear, cinematic lighting."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "16:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-kontext-max-t2i",
    "name": "Flux Kontext Max T2I",
    "inputs": {
      "prompt": {
        "examples": [
          "A realistic portrait of a woman with curly hair, wearing a silk blouse, studio lighting, high detail."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9",
          "16:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "gpt4o-text-to-image",
    "name": "Gpt4o Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A diagram of the solar system with labeled planets, cartoon style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "num_images": {
        "enum": [
          1,
          2,
          4
        ],
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "midjourney-v7-text-to-image",
    "name": "Midjourney v7 Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A sprawling futuristic city at dusk, illuminated with vibrant neon signs, layered skyscrapers, elevated highways with flying cars, warm atmospheric glow, ultra-detailed sci-fi architecture, cinematic composition — digital art, high contrast, 8K"
        ],
        "description": "The prompt to generate the image",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "speed": {
        "enum": [
          "relaxed",
          "fast",
          "turbo"
        ],
        "title": "Speed",
        "name": "speed",
        "type": "string",
        "description": "The speed of which corresponds to different speed of Midjourney",
        "default": "relaxed"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "variety": {
        "title": "Variety",
        "name": "variety",
        "type": "int",
        "description": "Controls the diversity of generated images. Increment by 5 each time. Higher values create more diverse results. Lower values create more consistent results.",
        "default": 5,
        "minValue": 0,
        "maxValue": 100,
        "step": 5
      },
      "stylization": {
        "title": "Stylization",
        "name": "stylization",
        "type": "int",
        "description": "Controls the artistic style intensity. Higher values create more stylized results. Lower values create more realistic results.",
        "default": 1,
        "minValue": 0,
        "maxValue": 1000,
        "step": 1
      },
      "weirdness": {
        "title": "Weirdness",
        "name": "weirdness",
        "type": "int",
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
    "id": "flux-schnell",
    "name": "Flux Schnell",
    "endpoint": "flux-schnell-image",
    "inputs": {
      "prompt": {
        "examples": [
          "A cozy mountain cabin surrounded by pine trees during snowfall, warm light glowing from windows, twilight scene"
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image. The value must be divisible by 64, eg: 128...512, 576, 640...2048.",
        "default": 1024,
        "minValue": 128,
        "maxValue": 2048,
        "step": 64
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
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "bytedance-seedream-v3",
    "name": "Bytedance Seedream v3",
    "inputs": {
      "prompt": {
        "examples": [
          "A magical forest with glowing mushrooms and a crystal river under a starry sky, dreamy and ethereal style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "qwen-image",
    "name": "Qwen Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A serene Japanese garden in autumn, with red maple leaves falling gently, a small stone bridge over a koi pond, photorealistic detail, soft morning light"
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "16:9"
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
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "flux-pulid",
    "name": "Flux Pulid",
    "inputs": {
      "prompt": {
        "examples": [
          "Recreate the same person in a Renaissance-style painting with ornate collar and soft candlelight ambiance."
        ],
        "description": "Text prompt describing the image (max 1500 characters).",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/818590409074/b5aa9200-ed01-43b2-8ed7-091255f3d164.jpg"
        ],
        "description": "URL of the input image used to generate image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "ideogram-v3-t2i",
    "name": "Ideogram v3 T2I",
    "inputs": {
      "prompt": {
        "examples": [
          "A retro 80s style poster with the words 'MARKETER.SH' glowing in pink and blue neon lights, cyberpunk city skyline in the background, cinematic design, highly detailed."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "render_speed": {
        "enum": [
          "Turbo",
          "Balanced",
          "Quality"
        ],
        "title": "Render Speed",
        "name": "render_speed",
        "type": "string",
        "description": "The rendering speed to use.",
        "default": "Balanced"
      },
      "style": {
        "enum": [
          "Auto",
          "General",
          "Realistic",
          "Design"
        ],
        "title": "Style",
        "name": "style",
        "type": "string",
        "description": "The style type to generate with.",
        "default": "Auto"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "3:4",
          "4:3",
          "9:16",
          "16:9"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1,
        "isEdit": true
      }
    },
    "provider": "ideogram",
    "provider_name": "Ideogram"
  },
  {
    "id": "google-imagen4",
    "name": "Google Imagen4",
    "inputs": {
      "prompt": {
        "examples": [
          "A grand waterfall cascading down glowing crystal cliffs under a twilight sky, bioluminescent plants illuminating the scene, a lone explorer standing on a cliff edge with a futuristic lantern, cinematic ultra-realism."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1,
        "isEdit": true
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "google-imagen4-fast",
    "name": "Google Imagen4 Fast",
    "inputs": {
      "prompt": {
        "examples": [
          "A playful panda astronaut bouncing on the moon, leaving heart-shaped footprints, with a pastel-colored galaxy in the background."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1,
        "isEdit": true
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "google-imagen4-ultra",
    "name": "Google Imagen4 Ultra",
    "inputs": {
      "prompt": {
        "examples": [
          "A close-up portrait of an old lighthouse keeper, wrinkled hands holding a brass lantern, stormy sea waves crashing behind, ultra-detailed realism."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "sdxl-image",
    "name": "Sdxl Image",
    "inputs": {
      "prompt": {
        "examples": [
          "An elven archer standing in a bioluminescent forest at night, glowing foliage, intricate leather armor, dynamic pose, painterly high-detail concept art."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "stability",
    "provider_name": "Stability AI"
  },
  {
    "id": "bytedance-seedream-v4",
    "name": "Bytedance Seedream v4",
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
    "id": "hunyuan-image-2.1",
    "name": "Hunyuan Image 2.1",
    "inputs": {
      "prompt": {
        "examples": [
          "A vast ink-wash landscape where misty mountains rise into drifting clouds, rivers flowing like silver threads across valleys. In the distance, a solitary pavilion glows with warm lantern light, blending classical Chinese painting aesthetics with modern cinematic realism."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "hunyuan",
    "provider_name": "Hunyuan"
  },
  {
    "id": "chroma-image",
    "name": "Chroma Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A futuristic studio bathed in radiant beams of shifting neon colors — cyan, magenta, amber, and emerald — that blend into surreal gradients across walls and objects. A crystal-like prism floats at the center, splitting light into vibrant chromatic waves that ripple outward, painting the scene in glowing, ever-changing hues."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "stability",
    "provider_name": "Stability AI"
  },
  {
    "id": "flux-redux",
    "name": "Flux Redux",
    "inputs": {
      "prompt": {
        "examples": [
          "Reimagine the forest cabin as a mystical fantasy retreat at twilight, glowing lanterns hanging from the trees, magical fireflies in the air, cinematic atmosphere with enchanted vibes."
        ],
        "description": "Text prompt describing the image (max 1500 characters).",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/flux-redux-input.jpg"
        ],
        "description": "URL of the input image used to generate image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
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
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-krea-dev",
    "name": "Flux Krea Dev",
    "inputs": {
      "prompt": {
        "examples": [
          "Close-up shot of a midnight blue sports car on wet asphalt, city lights reflected in its paint, shallow depth of field, cinematic realism."
        ],
        "description": "Text prompt describing the image. The length of the prompt must be between 2 and 3000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
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
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "perfect-pony-xl",
    "name": "Perfect Pony Xl",
    "inputs": {
      "prompt": {
        "examples": [
          "A warm, photorealistic portrait of a dappled pony standing in a sunlit stable, dust motes floating in golden light, textured mane, high detail on fur and eyes."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "stability",
    "provider_name": "Stability AI"
  },
  {
    "id": "neta-lumina",
    "name": "Neta Lumina",
    "inputs": {
      "prompt": {
        "examples": [
          "A poised young woman with long silver hair and heterochromatic eyes (one blue, one green), wearing a flowing cheongsam with cranes embroidered, standing in a dimly lit grand staircase. Soft ethereal lighting, painterly anime style, rich textures, delicate lace and pearl accessories."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "stability",
    "provider_name": "Stability AI"
  },
  {
    "id": "wan2.5-text-to-image",
    "name": "Wan2.5 Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A majestic waterfall cascading from towering cliffs into a misty valley, with glowing bioluminescent plants along the riverbanks, a lone explorer standing on a rock, cinematic lighting and ultra-detailed scenery."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 768,
        "maxValue": 1440,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1322,
        "minValue": 768,
        "maxValue": 1440,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "hunyuan-image-3.0",
    "name": "Hunyuan Image 3.0",
    "inputs": {
      "prompt": {
        "examples": [
          "A traditional Chinese courtyard with red lanterns hanging from wooden beams, moonlight reflecting from jade floor tiles. In the courtyard, a modern artist sits painting on an easel, neon blue sneakers, graffiti-style mural beginning behind them. Blend of classical aesthetics and modern street art."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      }
    },
    "provider": "hunyuan",
    "provider_name": "Hunyuan"
  },
  {
    "id": "leonardoai-phoenix-1.0",
    "name": "Leonardoai Phoenix 1.0",
    "inputs": {
      "prompt": {
        "examples": [
          "A magical forest at twilight, giant bioluminescent mushrooms illuminating a misty path, a crystal-clear river winding through twisted trees, fireflies dancing, soft ambient glow, ancient stone ruins partially visible, cinematic fantasy lighting, high-detail textures on foliage and moss, ethereal atmosphere, volumetric lighting rays piercing through branches."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "leonardoai",
    "provider_name": "Leonardo AI"
  },
  {
    "id": "leonardoai-lucid-origin",
    "name": "Leonardoai Lucid Origin",
    "inputs": {
      "prompt": {
        "examples": [
          "A towering medieval castle perched on a cliff, waterfalls cascading around it, sunrise casting golden light on the stone walls, mist rising from the valley below, flying dragons circling above, realistic clouds and sky reflections, cinematic wide-angle view, ultra-detailed textures on stone and water, epic fantasy atmosphere."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "leonardoai",
    "provider_name": "Leonardo AI"
  },
  {
    "id": "reve-text-to-image",
    "name": "Reve Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "An astronaut stands in a strange, bioluminescent purple jungle on an alien planet. She slowly reaches out her hand as a graceful creature made of translucent energy curiously approaches, gently touching her glove's fingertip with its tendril. The reflection of the planet's two moons is visible on her helmet's visor. Sense of wonder, photorealistic, cinematic."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "21:9",
          "16:9",
          "4:3",
          "1:1",
          "3:4",
          "9:16",
          "9:21"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      }
    },
    "provider": "reve",
    "provider_name": "Reve"
  },
  {
    "id": "grok-imagine-text-to-image",
    "name": "Grok Imagine Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A futuristic samurai standing under glowing neon lights in a rainy cyberpunk alley, reflections on wet pavement, dramatic rim lighting, highly detailed armor, cinematic atmosphere, ultra-realistic style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Aspect ratio of the output image. Get 6 images each time.",
        "default": "1:1"
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "nano-banana-pro",
    "name": "Nano Banana Pro",
    "endpoint": "nano-banana-pro",
    "inputs": {
      "prompt": {
        "examples": [
          "A radiant golden banana floating in a futuristic glass chamber, surrounded by swirling particles of light and data streams forming geometric shapes. Electric blue reflections ripple across the surface as energy pulses outward, turning fragments of light into vivid artworks suspended mid-air. Symbolizing playful innovation, AI precision, and evolution of creative power."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
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
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "resolution": {
        "enum": [
          "1k",
          "2k",
          "4k"
        ],
        "description": "The target resolution of the generated image.",
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "default": "1k"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "kling-o1-text-to-image",
    "name": "Kling O1 Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A towering arcology city at dusk built into a canyon, terraces lit with warm lanterns and bioluminescent gardens cascading down the rock face. Floating trams glide between terraces, mist curls from hidden waterfalls, and a faint green aurora shivers above the canyon rim. Deep orange sunset meets teal dusk, dramatic rim lighting, ultra-detailed architecture, cinematic wide-angle composition, 8k, hyperreal textures."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
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
      "resolution": {
        "enum": [
          "1k",
          "2k"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The target resolution of the generated image.",
        "default": "1k"
      },
      "num_images": {
        "title": "Number of images",
        "name": "num_images",
        "type": "int",
        "description": "Number of images generated in single request. Each number will charge separately",
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
    "id": "z-image-turbo",
    "name": "Z Image Turbo",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal glass hourglass floating in a dark void, filled not with sand but with glowing galaxies swirling inside. Each galaxy emits colorful nebula clouds that leak through cracks in the glass, forming cosmic streams drifting into the darkness. Bright rim lighting around the hourglass, reflective glass surfaces, deep space background, ultra-detailed sci-fi render, 8k quality, volumetric glow, high contrast."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
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
    "id": "flux-2-dev",
    "name": "Flux 2 Dev",
    "inputs": {
      "prompt": {
        "examples": [
          "A giant mechanical butterfly made of chrome wings and glowing blue energy veins, hovering above a mirror-smooth lake during twilight. Each wing reflects the sky while emitting soft neon trails. The lake surface ripples lightly from the energy pulses. Mist rolls across the water, and distant mountains fade into a deep violet horizon. Ultra-realistic lighting, cinematic composition, 8k render, high contrast, reflective metal textures."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 256,
        "maxValue": 1536,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
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
    "id": "flux-2-flex",
    "name": "Flux 2 Flex",
    "inputs": {
      "prompt": {
        "examples": [
          "A monumental crystalline arch towering above an endless desert of shifting silver sand, glowing with internal prisms that refract rainbow beams across the dunes. Beneath the arch floats a slowly rotating orb of condensed starlight, casting long ethereal shadows. In the distance, colossal sand whales breach from metallic dunes, their bodies shimmering with mirrored scales. Overhead, a fractured moon illuminates the scene with cold blue radiance. Ultra-detailed fantasy–sci-fi fusion, cinematic wide-angle view, volumetric light rays, 8k clarity, high contrast, dreamlike atmosphere."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "resolution": {
        "enum": [
          "1k",
          "2k"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The target resolution of the generated image.",
        "default": "1k"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "flux-2-pro",
    "name": "Flux 2 Pro",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal throne forged from intertwining meteor-iron branches, floating above a storm-torn ocean. Each branch pulses with glowing red runes, casting fiery reflections across the churning waves below. Above the throne hovers a massive eclipsed sun, its corona exploding into swirling arcs of molten light. Lightning erupts from the clouds and climbs the metal branches like living serpents. A lone hooded figure stands at the edge of the water, cloak whipping in the wind, illuminated only by the molten eclipse. Ultra-cinematic composition, hyper-detailed textures, 8k resolution, dramatic contrast, dark epic fantasy atmosphere."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "resolution": {
        "enum": [
          "1k",
          "2k"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The target resolution of the generated image.",
        "default": "1k"
      }
    },
    "provider": "blackforest",
    "provider_name": "Black Forest Labs"
  },
  {
    "id": "vidu-q2-text-to-image",
    "name": "Vidu Q2 Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal floating serpent made of shimmering stardust coils around a broken moon suspended in deep space. Each scale glows with shifting nebula colors, sending ripples of light across the void. Meteor fragments drift slowly around the creature, leaving trails of violet plasma. Beneath the serpent, a crystalline ring structure orbits the shattered moon, reflecting cosmic beams in intricate patterns. The background is a star field swirling into a spiral galaxy, with vibrant energy storms crackling along the horizon. Ultra-cinematic cosmic fantasy, high contrast, 8k detail, volumetric glow, deep space atmosphere."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "16:9",
          "9:16",
          "1:1",
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
      "resolution": {
        "enum": [
          "1k",
          "2k",
          "4k"
        ],
        "title": "Resolution",
        "name": "resolution",
        "type": "string",
        "description": "The target resolution of the generated image.",
        "default": "1k"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "bytedance-seedream-v4.5",
    "name": "Bytedance Seedream V4.5",
    "inputs": {
      "prompt": {
        "examples": [
          "A massive floating temple forged from translucent sapphire glass hovers above a storm-lit ocean. Crystalline towers refract lightning into rainbow shards that scatter across the waves below. Gigantic chains made of glowing runes suspend the temple in the air as swirling storm clouds coil around it. Beneath the structure, a vortex of shimmering water spirals upward, feeding energy into the floating palace. Distant thunder illuminates the scene with cold blue flashes, casting dramatic shadows across the ocean surface. Ultra-cinematic fantasy–sci-fi fusion, hyper-detailed textures, volumetric lighting, 8k clarity."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
    "id": "gpt-image-1.5",
    "name": "Gpt Image 1.5",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal hourglass floating in a silent cosmic void, its upper chamber filled with swirling golden sand that transforms into glowing constellations as it falls. The lower chamber contains a miniature ocean suspended in zero gravity, with waves frozen mid-motion and bioluminescent creatures glowing beneath the surface. Cracks in the glass emit thin beams of white light that bend and refract through drifting stardust. In the background, fragmented planets orbit slowly, partially illuminated by a distant supernova. Ultra-cinematic surreal concept, dramatic contrast between warm gold and deep blue, hyper-detailed textures, volumetric light rays, 8k clarity, dreamlike atmosphere."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "2:3",
          "3:2"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "1:1"
      },
      "quality": {
        "enum": [
          "low",
          "medium",
          "high"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "description": "The quality of the generated image.",
        "default": "medium"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "gpt-image-2",
    "name": "Gpt Image 2",
    "endpoint": "gpt-image-2-text-to-image",
    "family": "gpt-2",
    "inputs": {
      "prompt": {
        "examples": [
          "A photorealistic product photo of a luxury watch resting on a slab of black marble, dramatic cinematic lighting with a soft rim glow, ultra-detailed metallic textures, shallow depth of field, studio quality."
        ],
        "description": "Text prompt describing the image. Up to 20,000 characters supported.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
          "auto",
          "1:1",
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "description": "Aspect ratio of the output image.",
        "default": "auto"
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
        "description": "The target resolution of the generated image.",
        "default": "2K"
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "wan2.6-text-to-image",
    "name": "Wan2.6 Text To Image",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal floating bridge forged from glowing white stone spans a vast abyss filled with swirling clouds of light. Along the bridge, towering statues carved from ancient marble stand in silent formation, their eyes emitting faint golden beams that illuminate engraved runes beneath their feet. Below the bridge, fragments of ruined cities drift slowly through the mist, catching reflections from the glowing stone above. Overhead, a twilight sky fades from deep blue to soft amber, with distant stars beginning to appear. Cinematic fantasy environment, high contrast lighting, volumetric fog, ultra-detailed textures, epic scale."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "int",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 768,
        "maxValue": 1440,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "int",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 768,
        "maxValue": 1440,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "qwen-text-to-image-2512",
    "name": "Qwen Text To Image 2512",
    "inputs": {
      "prompt": {
        "examples": [
          "A colossal biomechanical whale swimming slowly through a vast sky made of soft clouds and fractured light. Its translucent body reveals glowing internal organs shaped like rotating gears and flowing energy veins. Below it, a sprawling patchwork of farmland and rivers curves with the planet’s surface, catching reflections from the whale’s luminous glow. Long fabric banners trail from the whale’s fins, fluttering gently in the wind like ceremonial streamers. The camera angle is wide and aerial, emphasizing scale and serenity. Soft sunrise colors, cinematic depth, ultra-detailed surreal sci-fi atmosphere."
        ],
        "description": "Text prompt describing the image, what you want the final edited image to look like.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
    "id": "flux-2-klein-4b",
    "name": "Flux 2 Klein 4b",
    "inputs": {
      "prompt": {
        "examples": [
          "A small round robot sitting at a café table outdoors, holding a tiny cup of coffee with both hands. The robot has a simple white body, a glowing digital face showing a happy expression, and short stubby legs dangling from the chair. Morning sunlight casts soft shadows on the pavement, potted plants surround the café, and steam gently rises from the coffee cup. Clean, minimal, cute, modern illustration style, bright colors, friendly mood."
        ],
        "description": "Text prompt describing the image.",
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
    "id": "flux-2-klein-9b",
    "name": "Flux 2 Klein 9b",
    "inputs": {
      "prompt": {
        "examples": [
          "A cute corgi puppy wearing a tiny yellow raincoat stands on a wet sidewalk after rain. Small puddles reflect the city lights, and the puppy looks up with bright curious eyes while holding a green leaf in its mouth. Soft evening light, shallow depth of field, clean background, warm and cheerful mood, high detail fur texture, realistic yet adorable style."
        ],
        "description": "Text prompt describing the image.",
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
    "id": "z-image-base",
    "name": "Z Image Base",
    "inputs": {
      "prompt": {
        "examples": [
          "A cozy late-night diner interior with warm yellow lighting, rain tapping against large glass windows, and a lone barista cleaning the counter. A slice of pie sits under a glass dome, steam rises from a fresh cup of coffee, and neon signs outside softly glow and reflect across the wet street. Cinematic realism, shallow depth of field, calm mood, high detail, modern photography style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          null
        ],
        "description": "URL of the input image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
      },
      "strength": {
        "title": "Strength",
        "name": "strength",
        "type": "int",
        "description": "Controls the strength of the transformation. Higher values produce outputs more different from the input image.",
        "default": 0.6,
        "minValue": 0,
        "maxValue": 1,
        "step": 0.01
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "nano-banana-2",
    "name": "Nano Banana 2",
    "endpoint": "nano-banana-2",
    "family": "nano",
    "inputs": {
      "prompt": {
        "description": "Positive prompt for generation.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "examples": [
          "A futuristic cityscape with glowing neon lights reflected in rain-soaked streets, ultra-detailed 4K photography."
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
    "id": "seedream-5.0",
    "name": "Seedream 5.0",
    "endpoint": "seedream-5.0",
    "family": "seedream",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image to generate.",
        "examples": [
          "A futuristic city with soaring crystalline towers, suspended gardens, and neon-lit skyways under a twin-moon sky, captured in a cinematic, high-detail digital art style."
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
  },
  {
    "id": "minimax-image-01",
    "name": "MiniMax Image 01",
    "endpoint": "minimax-image-01",
    "family": "minimax",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image to generate (max 1500 characters).",
        "examples": [
          "A serene mountain lake at sunset with golden reflections on the water, surrounded by pine forests and snow-capped peaks, photorealistic, 8k."
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
        "description": "Number of images to generate in a single request.",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  }
,
  {
    "id": "bytedance-seedream-v5.0",
    "name": "Seedream 5.0",
    "endpoint": "seedream-5.0",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image to generate",
        "examples": [
          "A bright open sky at early morning with soft white clouds and clean sunlight. In the middle of the sky, giant physical letters made from translucent glass float in the air, casting realistic shadows and reflections through the clouds. The letters are thick, dimensional, and clearly readable, like real objects suspended in space. The camera is slightly low-angle, making the text feel present and important.\n\nThe floating glass letters spell clearly and prominently:\n\nSeedream 5.0 Lite\n\nUltra-clean, cinematic lighting, realistic reflections, sharp focus, premium 3D render, highly readable typography, modern tech poster aesthetic."
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
  },
  {
    "id": "z-image-p",
    "name": "Z-Image P",
    "endpoint": "z-image-p",
    "inputs": {
      "prompt": {
        "examples": [
          "A tiny Earth-like planet floating inside a glass bottle placed on a wooden table, clouds slowly swirling around the planet, extremely detailed macro photography style"
        ],
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired image content."
      },
      "negative_prompt": {
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "The negative prompt for image generation",
        "default": ""
      },
      "width": {
        "title": "Width",
        "name": "width",
        "type": "integer",
        "description": "Width of the output image.",
        "default": 1024,
        "minValue": 64,
        "maxValue": 1440,
        "step": 1
      },
      "height": {
        "title": "Height",
        "name": "height",
        "type": "integer",
        "description": "Height of the output image.",
        "default": 1024,
        "minValue": 64,
        "maxValue": 1440,
        "step": 1
      },
      "seed": {
        "title": "Seed",
        "name": "seed",
        "type": "int",
        "description": "Random seed for generation. Set to -1 for random.",
        "default": -1
      },
      "flow_shift": {
        "title": "Flow Shift",
        "name": "flow_shift",
        "type": "number",
        "description": "Increase if you get too many blurry/dark/bad images. Decrease to try increasing detail.",
        "default": 3.0,
        "minValue": 0.3,
        "maxValue": 7.0,
        "step": 0.1
      },
      "batch_size": {
        "title": "Batch Size",
        "name": "batch_size",
        "type": "integer",
        "description": "Number of images to generate.",
        "default": 1,
        "minValue": 1,
        "maxValue": 4,
        "step": 1
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "qwen-image-2.0",
    "name": "Qwen Image 2.0",
    "endpoint": "qwen-image-2.0",
    "inputs": {
      "prompt": {
        "description": "A description of the image you want to generate.",
        "title": "Prompt",
        "type": "string",
        "name": "prompt",
        "examples": [
          "An ancient library where bookshelves slowly transform into giant trees, glowing books hanging like fruits, magical forest atmosphere, warm cinematic light"
        ]
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
    "id": "qwen-image-2.0-pro",
    "name": "Qwen Image 2.0 Pro",
    "endpoint": "qwen-image-2.0-pro",
    "inputs": {
      "prompt": {
        "description": "A description of the image you want to generate.",
        "title": "Prompt",
        "type": "string",
        "name": "prompt",
        "examples": [
          "A massive transparent whale floating through the sky above a city, inside its body a fully lit miniature city with skyscrapers and highways, surreal cinematic lighting, ultra detailed"
        ]
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
    "id": "flux-2-klein-4b-turbo",
    "name": "Flux 2 Klein 4B Turbo",
    "endpoint": "flux-2-klein-4b-turbo",
    "inputs": {
      "prompt": {
        "examples": [
          "A small round robot sitting at a café table outdoors, holding a tiny cup of coffee with both hands."
        ],
        "description": "Text prompt describing the image.",
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
    "id": "flux-2-klein-9b-turbo",
    "name": "Flux 2 Klein 9B Turbo",
    "endpoint": "flux-2-klein-9b-turbo",
    "inputs": {
      "prompt": {
        "examples": [
          "A cute corgi puppy wearing a tiny yellow raincoat stands on a wet sidewalk after rain."
        ],
        "description": "Text prompt describing the image.",
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
    "id": "wan2.7-text-to-image",
    "name": "Wan 2.7 Text to Image",
    "endpoint": "wan2.7-text-to-image",
    "inputs": {
      "prompt": {
        "examples": [
          "A single raindrop frozen mid-air containing an entire futuristic city inside it, skyscrapers distorted by water refraction, macro ultra detailed."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
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
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "The aspect ratio of the generated image",
        "default": "1:1"
      },
      "thinking_mode": {
        "type": "boolean",
        "title": "Thinking Mode",
        "name": "thinking_mode",
        "description": "Enable thinking mode for enhanced reasoning and better image quality. Increases generation time.",
        "default": true
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.7-text-to-image-pro",
    "name": "Wan 2.7 Text to Image Pro",
    "endpoint": "wan2.7-text-to-image-pro",
    "inputs": {
      "prompt": {
        "examples": [
          "A busy street market floating high in the sky on giant platforms, vendors selling food while clouds pass through the stalls, dynamic lighting, cinematic wide shot."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "thinking_mode": {
        "type": "boolean",
        "title": "Thinking Mode",
        "name": "thinking_mode",
        "description": "Enable thinking mode for enhanced reasoning and better image quality. Increases generation time.",
        "default": true
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
    "id": "midjourney-v7",
    "name": "Midjourney V7",
    "endpoint": "midjourney-v7",
    "inputs": {
      "prompt": {
        "examples": [
          "A forgotten royal bathhouse hidden deep inside sandstone cliffs during monsoon rain, warm candlelight reflecting across flooded marble floors, silk curtains moving gently with humid wind, subtle human presence, atmospheric depth, breathtaking architectural detail, timeless cinematic realism, premium editorial composition"
        ],
        "description": "Text description of the image to generate.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [],
        "description": "Optional reference image URL. Influences the style and content of the generation.",
        "field": "image",
        "type": "string",
        "title": "Reference Image URL",
        "name": "image_url"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "21:9"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output image aspect ratio.",
        "default": "1:1"
      },
      "stylize": {
        "type": "int",
        "title": "Stylize",
        "name": "stylize",
        "description": "Controls how artistic the result is. Range: 0–1000. Lower = more literal, higher = more stylized.",
        "default": 100,
        "minValue": 0,
        "maxValue": 1000,
        "step": 10
      },
      "chaos": {
        "type": "int",
        "title": "Chaos",
        "name": "chaos",
        "description": "Controls variation between the 4 images. Range: 0–100. Higher = more diverse.",
        "default": 0,
        "minValue": 0,
        "maxValue": 100,
        "step": 1
      },
      "weird": {
        "type": "int",
        "title": "Weird",
        "name": "weird",
        "description": "Adds unconventional aesthetics. Range: 0–3000.",
        "default": 0,
        "minValue": 0,
        "maxValue": 3000,
        "step": 50
      },
      "negative_prompt": {
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "Things to exclude from the image, e.g. \"text, watermark\".",
        "examples": [
          "text, watermark, blurry"
        ]
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Reproducibility seed. Range: 0–4294967295. Same seed + same prompt ≈ similar result.",
        "default": 0,
        "minValue": 0,
        "maxValue": 4294967295,
        "step": 1
      }
    },
    "provider": "midjourney",
    "provider_name": "Midjourney"
  },
  {
    "id": "midjourney-v8",
    "name": "Midjourney V8",
    "endpoint": "midjourney-v8",
    "inputs": {
      "prompt": {
        "examples": [
          "A celestial cartographer mapping moving constellations inside a circular observatory suspended above waterfalls, rotating brass instruments casting shifting shadows, star reflections flowing across polished stone floors, elegant cinematic framing, highly detailed textures, dreamlike realism, sophisticated visual storytelling."
        ],
        "description": "Text description of the image to generate.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [],
        "description": "Optional reference image URL. Influences the style and content of the generation.",
        "field": "image",
        "type": "string",
        "title": "Reference Image URL",
        "name": "image_url"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "21:9"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output image aspect ratio.",
        "default": "1:1"
      },
      "stylize": {
        "type": "int",
        "title": "Stylize",
        "name": "stylize",
        "description": "Controls how artistic the result is. Range: 0–1000. Lower = more literal, higher = more stylized.",
        "default": 100,
        "minValue": 0,
        "maxValue": 1000,
        "step": 10
      },
      "chaos": {
        "type": "int",
        "title": "Chaos",
        "name": "chaos",
        "description": "Controls variation between the 4 images. Range: 0–100. Higher = more diverse.",
        "default": 0,
        "minValue": 0,
        "maxValue": 100,
        "step": 1
      },
      "weird": {
        "type": "int",
        "title": "Weird",
        "name": "weird",
        "description": "Adds unconventional aesthetics. Range: 0–3000.",
        "default": 0,
        "minValue": 0,
        "maxValue": 3000,
        "step": 50
      },
      "negative_prompt": {
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "Things to exclude from the image, e.g. \"text, watermark\".",
        "examples": [
          "text, watermark, blurry"
        ]
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Reproducibility seed. Range: 0–4294967295. Same seed + same prompt ≈ similar result.",
        "default": 0,
        "minValue": 0,
        "maxValue": 4294967295,
        "step": 1
      }
    },
    "provider": "midjourney",
    "provider_name": "Midjourney"
  },
  {
    "id": "midjourney-niji",
    "name": "Midjourney Niji",
    "endpoint": "midjourney-niji",
    "inputs": {
      "prompt": {
        "examples": [
          "An enormous traveling greenhouse drifting across frozen northern seas on mechanical legs, glass walls glowing warmly during a snowstorm, botanists tending rare luminous plants inside, cinematic atmosphere, intricate environmental storytelling, layered reflections on ice, emotionally rich composition, ultra-detailed realism, luxury cinematic aesthetic."
        ],
        "description": "Text description of the image to generate.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [],
        "description": "Optional reference image URL. Influences the style and content of the generation.",
        "field": "image",
        "type": "string",
        "title": "Reference Image URL",
        "name": "image_url"
      },
      "aspect_ratio": {
        "enum": [
          "1:1",
          "16:9",
          "9:16",
          "3:4",
          "4:3",
          "21:9"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Output image aspect ratio.",
        "default": "1:1"
      },
      "stylize": {
        "type": "int",
        "title": "Stylize",
        "name": "stylize",
        "description": "Controls how artistic the result is. Range: 0–1000. Lower = more literal, higher = more stylized.",
        "default": 100,
        "minValue": 0,
        "maxValue": 1000,
        "step": 10
      },
      "chaos": {
        "type": "int",
        "title": "Chaos",
        "name": "chaos",
        "description": "Controls variation between the 4 images. Range: 0–100. Higher = more diverse.",
        "default": 0,
        "minValue": 0,
        "maxValue": 100,
        "step": 1
      },
      "weird": {
        "type": "int",
        "title": "Weird",
        "name": "weird",
        "description": "Adds unconventional aesthetics. Range: 0–3000.",
        "default": 0,
        "minValue": 0,
        "maxValue": 3000,
        "step": 50
      },
      "negative_prompt": {
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "Things to exclude from the image, e.g. \"text, watermark\".",
        "examples": [
          "text, watermark, blurry"
        ]
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Reproducibility seed. Range: 0–4294967295. Same seed + same prompt ≈ similar result.",
        "default": 0,
        "minValue": 0,
        "maxValue": 4294967295,
        "step": 1
      }
    },
    "provider": "midjourney",
    "provider_name": "Midjourney"
  },
  {
    "id": "grok-imagine-text-to-image-quality",
    "name": "Grok Imagine (Quality)",
    "endpoint": "grok-imagine-text-to-image-quality",
    "inputs": {
      "prompt": {
        "examples": [
          "A futuristic samurai standing under glowing neon lights in a rainy cyberpunk alley, reflections on wet pavement, dramatic rim lighting, highly detailed armor, cinematic atmosphere, ultra-realistic style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Aspect ratio of the output image. Get 6 images each time.",
        "default": "1:1"
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "flux-2-klein-4b-text-to-image-lora",
    "name": "Flux 2 Klein 4B LoRA",
    "endpoint": "flux-2-klein-4b-text-to-image-lora",
    "inputs": {
      "prompt": {
        "examples": [
          "A small round robot sitting at a café table outdoors, holding a tiny cup of coffee, soft morning light, cute illustration style."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Up to 3 LoRA adapters to apply during generation.",
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
    "id": "flux-2-klein-9b-text-to-image-lora",
    "name": "Flux 2 Klein 9B LoRA",
    "endpoint": "flux-2-klein-9b-text-to-image-lora",
    "inputs": {
      "prompt": {
        "examples": [
          "A regal fantasy queen on a crystal throne, ornate crown, ethereal lighting, cinematic detail."
        ],
        "description": "Text prompt describing the image.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
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
        "description": "Up to 3 LoRA adapters to apply during generation.",
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
    "id": "kling-o3-image",
    "name": "Kling O3 Image",
    "endpoint": "kling-o3-image",
    "inputs": {
      "prompt": {
        "examples": [
          "Two rival street magicians performing impossible tricks inside a moving subway train during heavy rain, passengers frozen in shock as playing cards transform into living birds mid-air, reflections streaking across wet windows, chaotic cinematic energy, realistic motion blur, expressive human reactions, ultra detailed modern fashion, dramatic handheld camera feel, premium cinematic realism"
        ],
        "description": "Text prompt describing the image to generate. Maximum 2,000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "aspect_ratio": {
        "enum": [
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
        "description": "Output image aspect ratio.",
        "default": "16:9"
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
    "id": "nano-banana-2-lite",
    "name": "Nano Banana 2 Lite",
    "endpoint": "nano-banana-2-lite",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired image content.",
        "examples": [
          "A giant upside-down umbrella floating over an entire city, collecting rainwater into glowing rivers that flow upward into the sky, surreal cinematic realism, moody weather."
        ]
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
    "id": "bytedance-seedream-5.0-pro",
    "name": "Seedream 5.0 Pro",
    "endpoint": "seedream-5.0-pro",
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the image to generate",
        "examples": [
          "A cinematic portrait of a lighthouse keeper at dusk, dramatic rim lighting, hyper-detailed textures, 4K resolution."
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

/**
 * marketer.sh Studio model catalog — Image-to-video models.
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 123 models.
 */
import type { ModelDefinition } from '../types';

export const i2vModels: ModelDefinition[] = [
  {
    "id": "ai-video-effects",
    "name": "AI Video Effects",
    "endpoint": "generate_wan_ai_effects",
    "family": "effects",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to insert into the predefined prompt template for the selected effect.",
        "examples": [
          "a cute kitten"
        ]
      },
      "name": {
        "type": "string",
        "title": "Effect Type",
        "name": "name",
        "description": "The type of effect to apply to the video.",
        "enum": [
          "360 Rotation",
          "Abandoned Places",
          "Angry",
          "Animal Documentary",
          "Assassin It",
          "Baby It",
          "Boxing",
          "Bride It",
          "Cakeify",
          "Cartoon Jaw Drop",
          "Cats",
          "Crush It",
          "Crying",
          "Cyberpunk 2077",
          "Deflate It",
          "Disney Princess It",
          "Dogs",
          "Eye Close-Up",
          "Fantasy Landscapes",
          "Film Noir",
          "Fire",
          "Glamor",
          "Goblin",
          "Gun Reveal",
          "Hug Jesus",
          "Hulk Transformation",
          "Inflate It",
          "Jungle It",
          "Jumpscare",
          "Kamehameha",
          "Kiss Cam",
          "Kissing",
          "Lego",
          "Laughing",
          "Little Planet",
          "Live Wallpaper",
          "Looping Pixel Art",
          "Melt It",
          "Mona Lisa It",
          "Museum It",
          "Muscle Show Off",
          "Orc",
          "Pixar",
          "Pirate Captain",
          "POV Driving",
          "Princess It",
          "Puppy it",
          "Robotic Face Reveal",
          "Samurai It",
          "Sharingan Eyes",
          "Skyrim Fus-Ro-Dah",
          "Snow White It",
          "Squish It",
          "Steamboat Willie",
          "Super Saiyan Transformation",
          "Tsunami",
          "Ultra Wide",
          "VHS Footage",
          "VIP It",
          "Warrior It",
          "Wind Blast",
          "Younger Self Selfie",
          "Zen It",
          "Zoom Call"
        ],
        "default": "Cakeify"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "The quality of the generated video.",
        "enum": [
          "medium",
          "high"
        ],
        "default": "medium"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10
        ],
        "default": 5
      }
    },
    "provider": "muapi",
    "provider_name": "MuapiApp"
  },
  {
    "id": "motion-controls",
    "name": "Motion Controls",
    "endpoint": "generate_wan_ai_effects",
    "family": "effects",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to insert into the predefined prompt template for the selected effect.",
        "examples": [
          "a blueberry person"
        ]
      },
      "name": {
        "type": "string",
        "title": "Effect Type",
        "name": "name",
        "description": "The type of effect to apply to the video.",
        "enum": [
          "360 Orbit",
          "Arc Shot",
          "Car Chase",
          "Car Mount Cam",
          "Crash Zoom In",
          "Crash Zoom Out",
          "Crane Down",
          "Crane Overhead",
          "Crane Punch-In",
          "Crane Up",
          "Dirty Lens",
          "Dolly In",
          "Dolly Left",
          "Dolly Out",
          "Dolly Right",
          "Dolly Zoom In",
          "Dolly Zoom Out",
          "Dutch Angle",
          "Fast Dolly Zoom In",
          "Fast Dolly Zoom Out",
          "Fisheye Lens",
          "Focus Shift",
          "FPV Drone Cam",
          "Handheld Cam",
          "Head Tracking",
          "Hero Run",
          "Human Timelapse",
          "Landscape Timelapse",
          "Lazy Susan",
          "Lens Crac",
          "Lens Flare",
          "Matrix Shot",
          "Motion Blur",
          "Object POV",
          "Overhead",
          "Rap Video Cam",
          "Robotic Cam",
          "Snorricam",
          "Tilt Down",
          "Tilt Up",
          "Whip Pan",
          "Wiggle",
          "Zoom In",
          "Zoom In Through Object",
          "Zoom Into Mouth",
          "Zoom Out",
          "Zoom Out Through Object"
        ],
        "default": "360 Orbit"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "The quality of the generated video.",
        "enum": [
          "medium",
          "high"
        ],
        "default": "medium"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10
        ],
        "default": 5
      }
    },
    "provider": "muapi",
    "provider_name": "MuapiApp"
  },
  {
    "id": "vfx",
    "name": "VFX",
    "endpoint": "generate_wan_ai_effects",
    "family": "effects",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to insert into the predefined prompt template for the selected effect.",
        "examples": [
          "a Mercedes bench car"
        ]
      },
      "name": {
        "type": "string",
        "title": "Effect Type",
        "name": "name",
        "description": "The type of effect to apply to the video.",
        "enum": [
          "Building Explosion",
          "Car Explosion",
          "Decay Time-Lapse",
          "Disintegration",
          "Electricity",
          "Flying",
          "Huge Explosion",
          "Levitate",
          "Tornado"
        ],
        "default": "Car Explosion"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "The quality of the generated video.",
        "enum": [
          "medium",
          "high"
        ],
        "default": "medium"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10
        ],
        "default": 5
      }
    },
    "provider": "muapi",
    "provider_name": "MuapiApp"
  },
  {
    "id": "veo3-image-to-video",
    "name": "Veo3 Image To Video",
    "endpoint": "veo3-image-to-video",
    "family": "veo",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired video content.",
        "examples": [
          "On a neon-lit street corner, a hyped street performer with a mic shouts: 'Yo! Big drop today! VEO3 just launched on muapi!' A crowd cheers as holograms of videos burst into the air and the muapi logo spins above."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3-fast-image-to-video",
    "name": "Veo3 Fast Image To Video",
    "endpoint": "veo3-fast-image-to-video",
    "family": "veo",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired video content.",
        "examples": [
          "A spaceship hovers over Earth. A digital billboard beams out: 'MuAPI is broadcasting creativity across the galaxy.' A robot host floats in zero gravity holding a prompt card: 'Let’s turn this into a story.' Suddenly, video panels fly around the ship with generated content."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "runway-image-to-video",
    "name": "Runway Image To Video",
    "endpoint": "runway-image-to-video",
    "family": "runway",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to be used to generate a video",
        "examples": [
          "The camera smoothly zooms in on the sleek, futuristic race car as it speeds through a neon-lit urban tunnel at twilight, its glossy white surface reflecting the vibrant pink and blue lights streaking past. The precise detailing of the car’s aerodynamic curves and glowing accents is highlighted as droplets of water spray from the spinning tires, adding a palpable sense of motion and intensity. The driver’s black helmet, contrasted against the car’s gleaming body, remains sharply in focus, emphasizing the thrilling high-speed chase through the city. The blurred cityscape and illuminated digital billboards in the background create a high-tech, cyberpunk atmosphere, intensifying the scene’s adrenaline and futuristic vibe."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video. If 1080p is selected, 8-second video cannot be generated.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration in seconds. If 8-second video is selected, 1080p resolution cannot be used.",
        "enum": [
          5,
          8
        ],
        "default": 5
      }
    },
    "provider": "runway",
    "provider_name": "RunwayML"
  },
  {
    "id": "wan2.1-image-to-video",
    "name": "Wan2.1 Image To Video",
    "endpoint": "wan2.1-image-to-video",
    "family": "wan2.1",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Animate the girl in the painting to blink and look around while her hair moves gently in the wind."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "The quality of the generated video.",
        "enum": [
          "medium",
          "high"
        ],
        "default": "medium"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "midjourney-v7-image-to-video",
    "name": "Midjourney v7 Image To Video",
    "endpoint": "midjourney-v7-image-to-video",
    "family": "midjourney",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Add slow drifting fog, glowing mushrooms pulsating softly, and subtle camera zoom"
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
          "1:2",
          "2:1",
          "2:3",
          "3:2",
          "5:6",
          "6:5"
        ],
        "default": "1:1"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "1080p"
        ],
        "default": "480p"
      },
      "num_videos": {
        "type": "int",
        "title": "Number of videos",
        "name": "num_videos",
        "description": "Number of videos generated in single request. Each number will charge separately",
        "enum": [
          1,
          2,
          4
        ],
        "default": 1
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
    "id": "hunyuan-image-to-video",
    "name": "Hunyuan Image To Video",
    "endpoint": "hunyuan-image-to-video",
    "family": "hunyuan",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "The camera begins with a slow, deliberate zoom out from the figure standing on the rain-soaked rooftop, revealing the sleek, armored silhouette clutching a glowing katana that pulses with ominous red light. The deep blues and purples of the wet cityscape set a moody, cyberpunk atmosphere, with neon signs in vibrant pinks, blues, and oranges casting reflections on the glistening surfaces below. The mist and rain softly blur the distant buildings and streetlights, emphasizing the isolation of the lone warrior framed against the sprawling urban expanse. As the camera pulls back, the subtle hum of the futuristic city grows louder, immersing the viewer in a world of tension and anticipation, where danger lurks in the glowing depths of the rain-drenched streets."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      }
    },
    "provider": "hunyuan",
    "provider_name": "Hunyuan"
  },
  {
    "id": "kling-v2.1-master-i2v",
    "name": "Kling v2.1 Master I2V",
    "endpoint": "kling-v2.1-master-i2v",
    "family": "kling-v2.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Animates wind effects, camera panning, and subtle movements like blinking or background motion, transforming the image into a compelling cinematic shot."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
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
    "id": "kling-v2.1-standard-i2v",
    "name": "Kling v2.1 Standard I2V",
    "endpoint": "kling-v2.1-standard-i2v",
    "family": "kling-v2.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "A female explorer stands at the edge of a cliff overlooking a dense jungle, her hair and cape rustling gently in the wind as the dramatic sunset casts warm, golden hues across the sky and landscape, capturing a moment of awe and adventure."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
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
    "id": "kling-v2.1-pro-i2v",
    "name": "Kling v2.1 Pro I2V",
    "endpoint": "kling-v2.1-pro-i2v",
    "family": "kling-v2.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "A cyberpunk woman with neon tattoos stands in a rainy alley as glowing signs reflect vividly in puddles around her. Her coat flutters slightly in the breeze, and she makes subtle head movements, capturing the moody, futuristic atmosphere without any scene changes."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
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
    "id": "wan2.2-image-to-video",
    "name": "Wan2.2 Image To Video",
    "endpoint": "wan2.2-image-to-video",
    "family": "wan2.2",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "A close-up video of a young woman smiling gently in the rain, with raindrops glistening on her face and eyelashes. The camera focuses on the delicate details of her expression and the shimmering water droplets, while soft light softly reflects off her skin, emphasizing the rainy atmosphere."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "The quality of the generated video.",
        "enum": [
          "medium",
          "high"
        ],
        "default": "medium"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds.",
        "default": 5,
        "minValue": 5,
        "maxValue": 8,
        "step": 3
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "runway-act-two-i2v",
    "name": "Runway Act Two I2V",
    "endpoint": "runway-act-two-i2v",
    "family": "runway",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4",
          "21:9"
        ],
        "default": "16:9"
      }
    },
    "provider": "runway",
    "provider_name": "Runway"
  },
  {
    "id": "pixverse-v4.5-i2v",
    "name": "Pixverse v4.5 I2V",
    "endpoint": "pixverse-v4.5-i2v",
    "family": "pixverse-v4.5",
    "imageField": "images_list",
    "lastImageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "A cat dressed in a sharp business suit stands confidently on a TED Talk stage, delivering an engaging lecture on quantum physics. The audience is filled with attentive dogs wearing glasses, reacting thoughtfully to the presentation. The video features dramatic camera zooms that highlight the cat speaker’s expressions and the intrigued faces of the canine audience, maintaining the setting and characters without altering the scene."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds. 8s not supported for 1080p resolution.",
        "default": 5,
        "minValue": 5,
        "maxValue": 8,
        "step": 3
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "vidu-v2.0-i2v",
    "name": "Vidu v2.0 I2V",
    "endpoint": "vidu-v2.0-i2v",
    "family": "vidu-v2",
    "imageField": "images_list",
    "lastImageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "A baby dragon wearing a tiny cape attempts to fly, wobbling uncertainly in the air with playful flaps of its wings, set against a bright and cheerful background. Light, upbeat music plays throughout, capturing the dragon's joyful effort. The video ends with the baby dragon gently crashing in a cute and harmless tumble, smiling and unfazed."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video. 16:9 for 360p/720p, 1:1 for 1080p are supported.",
        "enum": [
          "16:9",
          "1:1"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "360p",
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds.",
        "enum": [
          4
        ],
        "default": 4
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "vidu-q1-reference",
    "name": "Vidu Q1 Reference",
    "endpoint": "vidu-q1-reference",
    "family": "vidu-q1",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 7,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the desired video content.",
        "examples": [
          "Animate the character walking through the foggy forest at dawn, swinging the sword gracefully. Add cinematic camera pan and soft ambient lighting."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "1:1"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "minimax-hailuo-02-standard-i2v",
    "name": "Minimax Hailuo 02 Standard I2V",
    "endpoint": "minimax-hailuo-02-standard-i2v",
    "family": "minimax-2",
    "imageField": "image_url",
    "lastImageField": "end_image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Animate her looking out at the horizon as gentle waves crash, with her hair moving in the wind. Light, smooth motion, perfect for social clips."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          6,
          10
        ],
        "default": 6
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "512P",
          "768P"
        ],
        "default": "512P"
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "minimax-hailuo-02-pro-i2v",
    "name": "Minimax Hailuo 02 Pro I2V",
    "endpoint": "minimax-hailuo-02-pro-i2v",
    "family": "minimax-2",
    "imageField": "image_url",
    "lastImageField": "end_image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Transform this still image into a dramatic cinematic sequence: the scholar walks slowly through an ancient library where shelves tower endlessly into the shadows. The lantern’s flame flickers, casting moving patterns across scrolls and statues. Dust motes dance in golden light as the camera glides smoothly behind him, then pans upward to reveal an infinite expanse of glowing constellations painted across the ceiling that begin to shimmer and move as if alive."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          6
        ],
        "default": 6
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "1080p"
        ],
        "default": "1080p"
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "video-effects",
    "name": "Video Effects",
    "endpoint": "video-effects",
    "family": "effects",
    "imageField": "image_url",
    "hasPrompt": false,
    "inputs": {
      "name": {
        "type": "string",
        "title": "Effect Name",
        "name": "name",
        "description": "The type of effect to apply to the video.",
        "enum": [
          "Balloon Flyaway",
          "Blow Kiss",
          "Body Shake",
          "Break Glass",
          "Carry Me",
          "Cartoon Doll",
          "Cheek Kiss",
          "Child Memory",
          "Couple Arrival",
          "Fairy Me",
          "Fashion Stride",
          "Fisherman",
          "Flower Receive",
          "Flying",
          "French Kiss",
          "Gender Swap",
          "Golden Epoch",
          "Hair Swap",
          "Hugging",
          "Jiggle Up",
          "Kissing Pro",
          "Live Memory",
          "Love Drop",
          "Melt",
          "Minecraft",
          "Muscling",
          "Nap Me 360p",
          "Paperman",
          "Pilot",
          "Pinch",
          "Pixel Me",
          "Romantic Lift",
          "Sexy Me",
          "Slice Therapy",
          "Soul Depart",
          "Split Stance Human",
          "Squid Game",
          "Toy Me",
          "Walk Forward",
          "Zoom In Fast",
          "Zoom Out"
        ],
        "default": "Balloon Flyaway"
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "seedance-lite-i2v",
    "name": "Seedance Lite I2V",
    "endpoint": "seedance-lite-i2v",
    "family": "bytedance",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "A lively dog is running swiftly across a sunlit park, with green trees softly blurred in the background to emphasize quick motion, capturing the energetic and joyful movement during the day."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 12,
        "step": 1
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-pro-i2v",
    "name": "Seedance Pro I2V",
    "endpoint": "seedance-pro-i2v",
    "family": "bytedance",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "A slow cinematic pan following a knight riding through a dense, foggy forest at dawn, with dramatic lighting casting long shadows and soft rays filtering through the misty trees, emphasizing the mysterious and atmospheric mood."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 12,
        "step": 1
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "pixverse-v5-i2v",
    "name": "Pixverse v5 I2V",
    "endpoint": "pixverse-v5-i2v",
    "family": "pixverse-v5",
    "imageField": "images_list",
    "lastImageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Animate the glowing stag slowly walking forward, fireflies drifting in the air, soft mist rolling across the clearing, camera gently circling around for a magical cinematic motion."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 8,
        "step": 3
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "seedance-lite-reference-video",
    "name": "Seedance Lite Reference Video",
    "endpoint": "seedance-lite-reference-to-video",
    "family": "bytedance",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 4,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "The businessman walks towards the sports car on the rooftop, places his hand on the hood, and gazes at the glowing skyline as the camera circles around dramatically, capturing the neon-lit atmosphere in ultra-realism."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 12,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "wan2.1-reference-video",
    "name": "Wan2.1 Reference Video",
    "endpoint": "wan2.1-reference-video",
    "family": "wan2.1",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 5,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "The motorcycle driving through the neon tunnel, reflections glowing on its body, dynamic tracking shot, cinematic product ad style."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "kling-v2.5-turbo-pro-i2v",
    "name": "Kling v2.5 Turbo Pro I2V",
    "endpoint": "kling-v2.5-turbo-pro-i2v",
    "family": "kling-v2.5",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Animate subtle cloak movement, glowing energy pulsing from the staff, storm clouds rolling above, camera orbiting slightly to add depth and atmosphere."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
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
    "id": "wan2.5-image-to-video",
    "name": "Wan2.5 Image To Video",
    "endpoint": "wan2.5-image-to-video",
    "family": "wan2.5",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Animate the scene: camera slowly dollies forward toward the robot, neon city lights begin to flicker, soft reflections shift across the dome glass, twilight deepens into night with subtle ambient glow. The robot raises its head and speaks in a clear futuristic voice: ‘WAN 2.5 is now available on the MuAPI app.’"
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.5-image-to-video-fast",
    "name": "Wan2.5 Image To Video Fast",
    "endpoint": "wan2.5-image-to-video-fast",
    "family": "wan2.5",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "The camera slowly pulls back from the portrait, revealing the rooftop garden swaying in the breeze, clouds drifting across the orange-pink sky. The city lights begin to flicker on in the distance as the sun sets. She gazes at the horizon and softly says: “Every ending feels like the start of something new.” Natural ambient sounds of wind and faint city life in the background."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 10,
        "step": 5
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "openai-sora-2-image-to-video",
    "name": "Openai Sora 2 Image To Video",
    "endpoint": "openai-sora-2-image-to-video",
    "family": "sora",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Camera pans along the platform as the bullet train doors open, passengers step forward with rolling suitcases. Footsteps and soft chatter fill the air. A female announcer says: ‘Train number 2245 to Tokyo is now departing from platform 3.’ Wheels screech lightly as the train starts moving."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          10,
          15
        ],
        "default": 10
      },
      "remove_watermark": {
        "type": "boolean",
        "title": "Remove Watermark",
        "name": "remove_watermark",
        "description": "When enabled, removes watermarks from the generated video.",
        "default": true
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "ovi-image-to-video",
    "name": "Ovi Image To Video",
    "endpoint": "ovi-image-to-video",
    "family": "ovi",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Camera: static medium shot. The scientist speaks: <S>We have discovered life beyond Earth.<E> <AUDCAP>Soft electronic hum, distant Beep of instruments<ENDAUDCAP>"
        ]
      }
    },
    "provider": "muapi",
    "provider_name": "Muapi"
  },
  {
    "id": "openai-sora-2-pro-image-to-video",
    "name": "Openai Sora 2 Pro Image To Video",
    "endpoint": "openai-sora-2-pro-image-to-video",
    "family": "sora",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Scene: Submerged coral clearing, soft light filtering from above.\nCharacters: Tiny jellyfish with monocle and top hat, hosting tea for small seahorses.\nAction: Jellyfish floats and pours tea → bubbles rise slowly; seahorses sip → tiny octopus clumsily serves cake.\nCamera: Wide underwater → tracking floating jellyfish → macro on bubbles.\nLook & Lighting: Aqua-blue palette; subtle caustics on sand; shimmering reflections on water surfaces.\nMotion/Physics: Water currents gently sway characters; bubbles rise naturally; floating cakes wobble lightly.\nAudio: Bubbling water + faint harp melody; line: “Tea, my dear friends, before it drifts away.”"
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds. Currently 25 seconds supports 720p only.",
        "enum": [
          10,
          15,
          25
        ],
        "default": 10
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "remove_watermark": {
        "type": "boolean",
        "title": "Remove Watermark",
        "name": "remove_watermark",
        "description": "When enabled, removes watermarks from the generated video.",
        "default": true
      }
    },
    "provider": "openai",
    "provider_name": "OpenAI"
  },
  {
    "id": "leonardoai-motion-2.0",
    "name": "Leonardoai Motion 2.0",
    "endpoint": "leonardoai-motion-2.0",
    "family": "leonardoai",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "A diver swimming through a coral reef, colorful fish darting around, sunlight filtering through the water, slow-motion effect."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      }
    },
    "provider": "leonardoai",
    "provider_name": "Leonardo AI"
  },
  {
    "id": "veo3.1-image-to-video",
    "name": "Veo3.1 Image To Video",
    "endpoint": "veo3.1-image-to-video",
    "family": "veo3.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Scene: Giant floating library orbiting in zero-gravity space.\nCharacters: Astronaut-librarian flipping glowing pages suspended midair.\nAction: Camera rotates 360° around drifting books → zooms through a floating page into a nebula outside window.\nCamera: Orbit + push-through transition.\nLighting: Cool cosmic ambient with warm page glows; rim lighting on suit.\nMotion: Slow rotational drift; pages react with fluid inertia.\nAudio: Ethereal synth pads + book rustle in vacuum hush.\nMood: Awe, wonder, intellectual calm.\nLine: “Wow veo3.1 launched in Muapiapp. Let's go!”"
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          8
        ],
        "default": 8
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "1080p"
        ],
        "default": "1080p"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-fast-image-to-video",
    "name": "Veo3.1 Fast Image To Video",
    "endpoint": "veo3.1-fast-image-to-video",
    "family": "veo3.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Scene: Lantern festival by the river at night.\nCharacters: Young boy with his grandmother.\nAction: Camera starts behind them → tracks one lantern downstream → lift to sky full of lights.\nLighting: Warm candlelight vs cool night reflections.\nAudio: Gentle music, water flow.\nDialogue:\nGrandmother: “Every lantern carries a wish.”\nBoy: “Then mine’s for you to stay forever.”\nGrandmother (smiling): “I’ll be right there, glowing among them.”"
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          8
        ],
        "default": 8
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "1080p"
        ],
        "default": "1080p"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-lite-image-to-video",
    "name": "Veo3.1 Lite Image To Video",
    "endpoint": "veo3.1-lite-image-to-video",
    "family": "veo3.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video."
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          8
        ],
        "default": 8
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "1080p"
        ],
        "default": "1080p"
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "veo3.1-reference-to-video",
    "name": "Veo3.1 Reference To Video",
    "endpoint": "veo3.1-reference-to-video",
    "family": "veo3.1",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 3,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "A small robotic fox exploring a sun-drenched enchanted forest. The fox hops across a sparkling stream, pauses on mossy rocks, and looks curiously at glowing fireflies. Cinematic camera pans follow the fox from behind, then orbit slightly to reveal sunbeams filtering through the canopy. Warm dappled lighting with volumetric light rays and soft particle effects. Gentle ambient forest sounds and faint magical chimes. Dialogue: ‘Everything shines differently under the forest light…’"
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          8
        ],
        "default": 8
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio.",
        "default": true
      }
    },
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "seedance-pro-i2v-fast",
    "name": "Seedance Pro I2V Fast",
    "endpoint": "seedance-pro-i2v-fast",
    "family": "bytedance",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "The cyberpunk samurai turns slowly toward the camera, raindrops gliding off his glowing armor, neon lights reflecting on wet metal, camera pans around him in a slow 360°, subtle lightning flashes illuminate the skyline."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 2,
        "maxValue": 12,
        "step": 1
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "ltx-2-pro-image-to-video",
    "name": "Ltx 2 Pro Image To Video",
    "endpoint": "ltx-2-pro-image-to-video",
    "family": "ltx",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "An ancient stone portal deep in an enchanted forest, glowing runes, beams of sunlight breaking through the canopy, cinematic tracking shot, warm colour grading."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          6,
          8,
          10
        ],
        "default": 6
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio.",
        "default": true
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "ltx-2-fast-image-to-video",
    "name": "Ltx 2 Fast Image To Video",
    "endpoint": "ltx-2-fast-image-to-video",
    "family": "ltx",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Image of two explorers standing atop a dune. Now the viewpoint shifts: camera slowly dollies backward while sun rises behind them, sand drifts around feet, warm golden light, soft wind in audio."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
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
        "default": 6
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio.",
        "default": true
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "vidu-q2-reference",
    "name": "Vidu Q2 Reference",
    "endpoint": "vidu-q2-reference",
    "family": "vidu-q2",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 7,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "The female explorer walks slowly across the alien terrain, crystals glimmering around her. The camera glides beside her as light from twin suns scatters across her reflective suit. Wind stirs the mist as she looks up toward the horizon, where a colossal planet looms above — evoking awe and wonder."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 2,
        "maxValue": 8,
        "step": 1
      },
      "movement_amplitude": {
        "type": "string",
        "title": "Movement Amplitude",
        "name": "movement_amplitude",
        "description": "The movement amplitude of objects in the frame.",
        "enum": [
          "auto",
          "small",
          "medium",
          "large"
        ],
        "default": "auto"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "vidu-q2-turbo-start-end-video",
    "name": "Vidu Q2 Turbo Start End Video",
    "endpoint": "vidu-q2-turbo-start-end-video",
    "family": "vidu-q2",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "The camera begins behind the traveler standing amid the misty ancient ruins. Leaves swirl in the air as golden light flickers. A surge of energy surrounds the traveler — ruins start to dissolve into bright particles. The environment morphs into a neon-lit futuristic city as the traveler continues walking forward, entering the new world."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 2,
        "maxValue": 8,
        "step": 1
      },
      "bgm": {
        "type": "boolean",
        "title": "Bgm",
        "name": "bgm",
        "description": "The background music for generating the output.",
        "default": true
      },
      "movement_amplitude": {
        "type": "string",
        "title": "Movement Amplitude",
        "name": "movement_amplitude",
        "description": "The movement amplitude of objects in the frame.",
        "enum": [
          "auto",
          "small",
          "medium",
          "large"
        ],
        "default": "auto"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "vidu-q2-pro-start-end-video",
    "name": "Vidu Q2 Pro Start End Video",
    "endpoint": "vidu-q2-pro-start-end-video",
    "family": "vidu-q2",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Camera begins behind the cabin as snowflakes drift through pale dawn light. Warm sunlight pierces the mist — the snow slowly melts, trees turn green, and the ground blossoms with flowers. The air brightens into a spring sunrise as birds take flight over the cabin, symbolizing rebirth and renewal."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 2,
        "maxValue": 8,
        "step": 1
      },
      "bgm": {
        "type": "boolean",
        "title": "Bgm",
        "name": "bgm",
        "description": "The background music for generating the output.",
        "default": true
      },
      "movement_amplitude": {
        "type": "string",
        "title": "Movement Amplitude",
        "name": "movement_amplitude",
        "description": "The movement amplitude of objects in the frame.",
        "enum": [
          "auto",
          "small",
          "medium",
          "large"
        ],
        "default": "auto"
      }
    },
    "provider": "vidu",
    "provider_name": "Vidu"
  },
  {
    "id": "minimax-hailuo-2.3-pro-i2v",
    "name": "Minimax Hailuo 2.3 Pro I2V",
    "endpoint": "minimax-hailuo-2.3-pro-i2v",
    "family": "minimax-2.3",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "The camera slowly moves around the woman as the wind gently sways the tall grass. Her hair flows with the breeze, sunlight flickering through passing clouds. The atmosphere feels calm, nostalgic, and cinematic."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "1080p"
        ],
        "default": "1080p"
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "minimax-hailuo-2.3-standard-i2v",
    "name": "Minimax Hailuo 2.3 Standard I2V",
    "endpoint": "minimax-hailuo-2.3-standard-i2v",
    "family": "minimax-2.3",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Camera slowly moves forward over the lake surface as light wind ripples the water. The clouds drift across the mountains, and sunlight flickers on the waves, creating a peaceful cinematic mood."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          6,
          10
        ],
        "default": 6
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "minimax-hailuo-2.3-fast",
    "name": "Minimax Hailuo 2.3 Fast",
    "endpoint": "minimax-hailuo-2.3-fast",
    "family": "minimax-2.3",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "The camera gently moves around the woman as snowflakes drift through the air. Her expression shifts slightly as the wind brushes her hair. The background lights shimmer softly, creating a calm cinematic mood."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          6,
          10
        ],
        "default": 6
      },
      "go_fast": {
        "type": "boolean",
        "title": "Go Fast",
        "name": "go_fast",
        "description": "Prioritize faster video generation speed with a moderate trade-off in visual quality.",
        "default": true
      }
    },
    "provider": "minimax",
    "provider_name": "Minimax"
  },
  {
    "id": "kling-v2.5-turbo-std-i2v",
    "name": "Kling v2.5 Turbo Std I2V",
    "endpoint": "kling-v2.5-turbo-std-i2v",
    "family": "kling-v2.5",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Animate subtle cloak movement, glowing energy pulsing from the staff, storm clouds rolling above, camera orbiting slightly to add depth and atmosphere."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
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
    "id": "grok-imagine-image-to-video",
    "name": "Grok Imagine Image To Video",
    "endpoint": "grok-imagine-image-to-video",
    "family": "grok",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 7,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Camera glides through vines toward temple entrance, mist disperses as sunlight pierces canopy, birds fly off, subtle dust motes in the air, adventure-style cinematic score."
        ]
      },
      "mode": {
        "type": "string",
        "title": "Mode",
        "name": "mode",
        "description": "Note: When generating videos using external image inputs, Spicy mode is not supported and will automatically switch to Normal.",
        "enum": [
          "fun",
          "normal",
          "spicy"
        ],
        "default": "normal"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds.",
        "enum": [
          6,
          10,
          15
        ],
        "default": 6
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "kling-o1-image-to-video",
    "name": "Kling O1 Image To Video",
    "endpoint": "kling-o1-image-to-video",
    "family": "kling-o1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "A gentle dolly forward toward the cabin as morning light intensifies, mist lifts in streaks, subtle water ripples, birds take flight, warm golden hour soundscape."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10
        ],
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-o1-reference-to-video",
    "name": "Kling O1 Reference To Video",
    "endpoint": "kling-o1-reference-to-video",
    "family": "kling-o1",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 7,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Cinematic orbit camera move around the pilot in a futuristic hangar, holographic lights flickering, armor reflections shifting, soft mechanical ambience."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 10,
        "step": 1
      },
      "keep_original_sound": {
        "type": "boolean",
        "title": "Keep Original Sound",
        "name": "keep_original_sound",
        "description": "Select whether to keep the video original sound through the parameter.",
        "default": true
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v2.6-pro-i2v",
    "name": "Kling v2.6 Pro I2V",
    "endpoint": "kling-v2.6-pro-i2v",
    "family": "kling-v2.6",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Slow cinematic orbit around the floating obsidian throne, holographic runes pulsing gently, drifting quartz shards rotating with soft parallax, molten crystal canyon glowing brighter with movement, and subtle particle storms rising toward the cosmic vortex; maintain original lighting, style, and atmosphere."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds.",
        "enum": [
          5,
          10
        ],
        "default": 5
      },
      "sound": {
        "type": "boolean",
        "title": "Sound",
        "name": "sound",
        "description": "Whether sound is generated simultaneously when generating a video.",
        "default": true
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "pixverse-v5.5-i2v",
    "name": "Pixverse v5.5 I2V",
    "endpoint": "pixverse-v5.5-i2v",
    "family": "pixverse-v5.5",
    "imageField": "images_list",
    "lastImageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Slow upward camera glide along the staircase, lanterns gently swaying, stardust drifting in soft spirals, nebula clouds subtly shifting, and the cosmic gateway pulsing with rhythmic light; maintain original colors, composition, and celestial atmosphere with smooth cinematic motion."
        ]
      },
      "style": {
        "type": "string",
        "title": "Style",
        "name": "style",
        "description": "The style of the generated video.",
        "enum": [
          "none",
          "anime",
          "3d_animation",
          "clay",
          "comic",
          "cyberpunk"
        ],
        "default": "none"
      },
      "thinking": {
        "type": "string",
        "title": "Thinking",
        "name": "thinking",
        "description": "Prompt optimization mode for model decision.",
        "enum": [
          "auto",
          "enabled",
          "disabled"
        ],
        "default": "auto"
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "4:3",
          "3:4"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "360p",
          "540p",
          "720p",
          "1080p"
        ],
        "default": "360p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds.",
        "enum": [
          5,
          8,
          10
        ],
        "default": 5
      },
      "audio": {
        "type": "boolean",
        "title": "Audio",
        "name": "audio",
        "description": "Enable audio generation (BGM, SFX, dialogue).",
        "default": false
      },
      "multi_clip": {
        "type": "boolean",
        "title": "Multi Clip",
        "name": "multi_clip",
        "description": "Enable multi-clip generation with dynamic camera changes.",
        "default": false
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "wan2.2-spicy-image-to-video",
    "name": "Wan2.2 Spicy Image To Video",
    "endpoint": "wan2.2-spicy-image-to-video",
    "family": "wan2.2",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Animate the scene with intense fiery motion—lava cracking and flowing down the phoenix wings, embers drifting upward, volcanic smoke swirling dramatically, floating stones shifting with parallax depth; camera performs a slow power-shot push-in toward the phoenix statue while preserving the glowing, high-contrast cinematic atmosphere."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p"
        ],
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          8
        ],
        "default": 5
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.6-image-to-video",
    "name": "Wan2.6 Image To Video",
    "endpoint": "wan2.6-image-to-video",
    "family": "wan2.6",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Add slow cinematic camera movement circling the floating lighthouse, orbiting symbol rings rotating gently with parallax depth, ocean waves shimmering and moving naturally, clouds drifting and lightning flashing subtly in the distance, and the lighthouse beam pulsing softly while preserving the original lighting and dramatic mood."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10,
          15
        ],
        "default": 5
      },
      "shot_type": {
        "type": "string",
        "title": "Shot Type",
        "name": "shot_type",
        "description": "The type of shot to generate.",
        "enum": [
          "single",
          "multi"
        ],
        "default": "single"
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "kling-o1-standard-image-to-video",
    "name": "Kling O1 Standard Image To Video",
    "endpoint": "kling-o1-standard-image-to-video",
    "family": "kling-o1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Add gentle camera drift forward with slight parallax depth, waterfalls flowing softly, clouds slowly moving beneath the island, birds gliding naturally through the scene, and sunlight shifting subtly while maintaining the calm cinematic mood and original lighting."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10
        ],
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-o1-standard-reference-to-video",
    "name": "Kling O1 Standard Reference To Video",
    "endpoint": "kling-o1-standard-reference-to-video",
    "family": "kling-o1",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 7,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to generate the video",
        "examples": [
          "Blend the reference scenes into a single cinematic shot with gentle forward camera movement, soft parallax depth between the bridge and forest valley, fog drifting slowly above the river, leaves swaying lightly in the breeze, and sunlight shifting subtly while maintaining a calm, realistic atmosphere."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10
        ],
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "seedance-v1.5-pro-i2v",
    "name": "Seedance v1.5 Pro I2V",
    "endpoint": "seedance-v1.5-pro-i2v",
    "family": "seedance-v1.5-pro",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Add a slow cinematic orbit around the floating archive, gentle parallax between cloud layers and spires, flowing data streams pulsing softly, fog drifting naturally, and sky colors deepening slightly while preserving the original lighting, scale, and cinematic mood."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 4,
        "maxValue": 12,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio",
        "default": true
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-v1.5-pro-i2v-fast",
    "name": "Seedance v1.5 Pro I2V Fast",
    "endpoint": "seedance-v1.5-pro-i2v-fast",
    "family": "seedance-v1.5-pro",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Add gentle forward camera movement toward the floating observatory, subtle parallax between clouds and structure, soft cloud drift below, interior window lights glowing steadily, and sunlight rays shifting slightly while keeping motion smooth, minimal, and fast."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "1:1",
          "3:4",
          "4:3",
          "21:9"
        ],
        "default": "16:9"
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 4,
        "maxValue": 12,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio",
        "default": true
      },
      "camera_fixed": {
        "type": "boolean",
        "title": "Camera Fixed",
        "name": "camera_fixed",
        "description": "Whether to fix the camera position",
        "default": false
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "ltx-2-19b-image-to-video",
    "name": "Ltx 2 19b Image To Video",
    "endpoint": "ltx-2-19b-image-to-video",
    "family": "ltx",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Animate the scene so the camera slowly pushes toward the billboard, the text characters on the woman’s face subtly scrolling and re-forming, rain falling continuously, reflections on the wet road shifting as car headlights flicker, pedestrians making small natural movements while the city lights pulse softly; maintain realistic motion, urban mood, and cinematic pacing."
        ]
      },
      "resolution": {
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "The resolution of the generated video.",
        "enum": [
          "480p",
          "720p",
          "1080p"
        ],
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 5,
        "maxValue": 20,
        "step": 1
      }
    },
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "kling-v3.0-omni-standard-image-to-video",
    "name": "Kling v3.0 Omni Standard Image To Video",
    "endpoint": "kling-v3.0-omni-standard-image-to-video",
    "family": "kling-v3.0-omni",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 4,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "During an intense basketball game, gravity suddenly breaks apart. Players begin running sideways across the arena walls while the court folds upward into impossible angles. The basketball floats briefly before being slammed through the hoop as the camera rotates dynamically with the shifting gravity."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "9:16",
          "16:9",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "Duration of the generated video in seconds.",
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
    "id": "kling-v3.0-omni-pro-image-to-video",
    "name": "Kling v3.0 Omni Pro Image To Video",
    "endpoint": "kling-v3.0-omni-pro-image-to-video",
    "family": "kling-v3.0-omni",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 4,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "A high-speed train races forward nonstop while the environment transforms every few seconds—from snowy mountains to neon cyberpunk city to volcanic wasteland. Sparks fly from the tracks as the camera stays tightly locked alongside the speeding train during each violent world transition."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "9:16",
          "16:9",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "Duration of the generated video in seconds.",
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
    "id": "kling-v3.0-omni-4k-image-to-video",
    "name": "Kling v3.0 Omni 4K Image To Video",
    "endpoint": "kling-v3.0-omni-4k-image-to-video",
    "family": "kling-v3.0-omni",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 4,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "A cat in @image1 wakes up and walks towards the camera in slow motion."
        ]
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "9:16",
          "16:9",
          "1:1"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "Duration of the generated video in seconds.",
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
        "default": 5
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-pro-image-to-video",
    "name": "Kling v3.0 Pro Image To Video",
    "endpoint": "kling-v3.0-pro-image-to-video",
    "family": "kling-v3.0",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "The camera begins on the railway station platform beside a stationary train as morning sunlight filters through the roof. Passengers make small natural movements while the train doors are open. The camera moves forward and enters the train, transitioning smoothly into a window-seat point of view. As the doors close, the train starts moving. The view shifts fully to the window, showing the city passing by outside with gentle motion blur, buildings and trees sliding past. Sunlight reflects on the glass, faint interior reflections appear, and the ride feels calm and realistic with smooth, cinematic motion."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio for the video",
        "default": true
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-standard-image-to-video",
    "name": "Kling v3.0 Standard Image To Video",
    "endpoint": "kling-v3.0-standard-image-to-video",
    "family": "kling-v3.0",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "The hamster begins on the left side of the tabletop and quickly runs across the surface toward the right. Its tiny legs move rapidly, body bouncing slightly with natural motion. As it runs, the sunflower seeds blur slightly beneath it. The hamster slows near the bowl, stops, and stands upright to grab a seed. The camera remains fixed, depth of field stays shallow, and lighting remains soft and consistent for a realistic, cute result."
        ]
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "default": 5,
        "minValue": 3,
        "maxValue": 15,
        "step": 1
      },
      "generate_audio": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio",
        "description": "Whether to generate audio for the video",
        "default": true
      }
    },
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "seedance-v2.0-i2v",
    "name": "Seedance 2.0 I2V",
    "endpoint": "seedance-v2.0-i2v",
    "family": "seedance-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "maxImages": 5,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "The prompt to guide video generation from the image."
      },
      "aspect_ratio": {
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio of the output video.",
        "enum": [
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "default": "16:9"
      },
      "duration": {
        "type": "int",
        "title": "Duration",
        "name": "duration",
        "description": "The duration of the generated video in seconds",
        "enum": [
          5,
          10,
          15
        ],
        "default": 5
      },
      "quality": {
        "type": "string",
        "title": "Quality",
        "name": "quality",
        "description": "Quality of the generated video.",
        "enum": [
          "high",
          "basic"
        ],
        "default": "basic"
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  }
,
  {
    "id": "seedance-2-i2v",
    "name": "Seedance 2 I2V",
    "endpoint": "seedance-v2.0-i2v",
    "family": "sd-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The lightbulb suddenly rockets across the room like a missile, smashing through curtains while water spins violently inside. The fish darts through swirling currents as the bulb ricochets off walls and finally bursts into floating droplets."
        ],
        "type": "string",
        "title": "Prompt",
        "description": "Text prompt describing the video animation. Reference uploaded images using @image1, @image2, … @imageN (1-based, matching images_list order). To use a fictional character, reference it with @character:<id> (request_id from a completed Seedance 2 Character generation) — characters are automatically appended to images_list. Multiple characters are supported. Example: '@character:ab539e5f walks through a garden' or 'The cat in @image1 meets @character:ab539e5f'."
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-i2v.jpg"
        ],
        "description": "Upload up to 9 image URLs. Reference them in the prompt using @image1, @image2, … @image9. The aspect ratio of the reference image takes precedence over the aspect_ratio parameter.",
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
    "id": "ltx-2.3-image-to-video",
    "name": "LTX 2.3",
    "endpoint": "ltx-2.3-image-to-video",
    "family": "ltx2.3",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The snail accelerates unexpectedly, smashing through trees while the miniature city erupts into chaos. Flying cars zip around the shell trying to stabilize the city as neon signs flicker and sparks fly from collapsing towers."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/ltx-2.3-image-to-video.png"
        ],
        "description": "URL of the input image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
    "id": "openai-sora-2-standard-image-to-video",
    "name": "Sora 2 Standard",
    "endpoint": "openai-sora-2-standard-image-to-video",
    "family": "sora",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the video you want to generate",
        "examples": [
          "The astronaut suddenly spins the spoon rapidly and the tea explodes into a swirling galaxy vortex. Planets shoot out of the cup like comets while the teacup begins rotating violently through space, stars stretching into light trails as the camera whips around the scene."
        ]
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/openai-sora-2-standard-image-to-video.png"
        ],
        "type": "string",
        "title": "Image URL",
        "name": "image_url",
        "description": "Input image to animate",
        "format": "uri",
        "field": "image"
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
    "id": "seedance-2-new-omni",
    "name": "Seedance 2 New Omni",
    "endpoint": "seedance-2.0-new-omni",
    "family": "sd-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt. Reference uploads via @image_file_1, @video_file_1, @audio_file_1, etc.",
        "examples": [
          "The character in @image_file_1 performs the moves from @video_file_1 with cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs. Each Nth image corresponds to @image_file_N in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
      },
      "video_files": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/videos/186/314541316386/621c8607-a60f-4503-b1bf-a2c1cd90c84f.mp4"
        ],
        "description": "Up to 3 reference video clip URLs. Each Nth video corresponds to @video_file_N in the prompt.",
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
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/minimax-speech-2.6-turbo.mp3"
        ],
        "description": "Up to 3 reference audio clip URLs. Each Nth audio corresponds to @audio_file_N in the prompt.",
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
        "description": "high = standard model; basic = fast model.",
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
    "id": "seedance-2-new-first-last",
    "name": "Seedance 2 New First Last",
    "endpoint": "seedance-2.0-new-first-last",
    "family": "sd-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video content between frames.",
        "examples": [
          "A smooth cinematic transition between two scenes."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame anchor; 2 images = first and last frame.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
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
        "description": "high = standard model; basic = fast model.",
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
    "id": "seedance-2-omni-reference",
    "name": "Seedance 2 Omni Reference",
    "endpoint": "seedance-2.0-omni-reference",
    "family": "sd-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "@image1 is the main character reference. A person walking on the beach at sunset, cinematic lighting"
        ],
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, @audio1…@audio3 for audio. To use a character sheet, reference it with @character:<request_id> (from a completed Seedance 2 Character generation). To use a trained Omni Reference character, reference it with @omni-character:<character_id> where character_id is the value returned by Omni Reference Train Character (e.g. char_1775422630065_4vbana). Both methods can be combined in the same prompt. Multiple characters are supported. Example: '@omni-character:char_1775422630065_4vbana walking through a neon-lit city at night'."
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-omni-reference.png"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "description": "Output video aspect ratio."
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "default": "high",
        "description": "Generation quality. 'high' uses the standard model ($0.30/sec output + $0.09/sec per input video second). 'basic' uses the fast model (~2x speed, $0.21/sec output + $0.063/sec per input video second). Video reference inputs incur an additional 30% surcharge based on their combined duration."
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
    "id": "pixverse-v6-i2v",
    "name": "Pixverse v6 I2V",
    "endpoint": "pixverse-v6-i2v",
    "family": "pixverse-v6",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video motion and content.",
        "examples": [
          "Cracks spread across the statue as it suddenly comes to life. Stone pieces fall off while glowing energy emerges from inside. The statue pulls itself free from the sand and takes a heavy step forward, shaking the ground as dust rises into the air."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/pixverse-v6-i2v.mp4"
        ],
        "description": "Upload or provide the input image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URL",
        "name": "images_list",
        "maxItems": 1
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
      "thinking_type": {
        "enum": [
          "auto",
          "enabled",
          "disabled"
        ],
        "type": "string",
        "title": "Prompt Optimization",
        "name": "thinking_type",
        "description": "Controls prompt enhancement. 'enabled' rewrites the prompt, 'disabled' uses it as-is, 'auto' lets the model decide.",
        "default": "auto"
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
    "id": "pixverse-v6-transition",
    "name": "Pixverse v6 Transition",
    "endpoint": "pixverse-v6-transition",
    "family": "pixverse-v6",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the transition or video content.",
        "examples": [
          "Water suddenly bursts through the walls and windows, flooding the room violently. Furniture lifts and begins floating as currents swirl. Fish appear and swim through the space while light rays ripple through the water. The camera drifts with the flow."
        ]
      },
      "image_url": {
        "type": "string",
        "title": "Starting Image",
        "name": "image_url",
        "description": "Upload starting image.",
        "field": "image",
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/pixverse-v6-transition.jpg"
        ]
      },
      "last_image": {
        "type": "string",
        "title": "Ending Image",
        "name": "last_image",
        "description": "Upload ending image (optional).",
        "field": "image",
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/pixverse-v6-transition-1.jpg"
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
        "description": "Output video orientation.",
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
        "description": "Video output quality.",
        "default": "720p"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Total length of the video.",
        "default": 5,
        "minValue": 1,
        "maxValue": 15,
        "step": 1
      },
      "thinking_type": {
        "type": "boolean",
        "title": "Enhanced Thinking",
        "name": "thinking_type",
        "description": "Enable enhanced thinking for more complex transitions.",
        "default": false
      },
      "style": {
        "enum": [
          "anime",
          "3d_animation",
          "clay",
          "comic",
          "cyberpunk"
        ],
        "type": "string",
        "title": "Style",
        "name": "style",
        "description": "Visual style of the generation."
      },
      "negative_prompt": {
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "What to avoid in the generation."
      },
      "generate_audio_switch": {
        "type": "boolean",
        "title": "Generate Audio",
        "name": "generate_audio_switch",
        "description": "Whether to generate background audio for the video.",
        "default": false
      }
    },
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "wan2.7-image-to-video",
    "name": "Wan2.7",
    "endpoint": "wan2.7-image-to-video",
    "family": "wan2.7",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [],
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description"
      },
      "image_url": {
        "examples": [],
        "type": "string",
        "title": "Image Url",
        "name": "image_url",
        "description": "First frame image",
        "field": "image"
      },
      "last_image": {
        "examples": [],
        "type": "string",
        "title": "Last Image",
        "name": "last_image",
        "description": "Last frame image (optional)",
        "field": "image"
      },
      "audio_url": {
        "examples": [],
        "type": "string",
        "title": "Audio URL",
        "name": "audio_url",
        "description": "Audio file to guide generation",
        "field": "audio"
      },
      "resolution": {
        "enum": [
          "720p",
          "1080p"
        ],
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
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
    "id": "wan2.7-reference-to-video",
    "name": "Wan2.7 Reference to Video",
    "endpoint": "wan2.7-reference-to-video",
    "family": "wan2.7",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired motion and scene.",
        "examples": [
          "A person walking in the rain..."
        ]
      },
      "images_list": {
        "examples": [],
        "description": "Array of reference image URLs (jpg/png). Max 4 items.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 4
      },
      "videos_list": {
        "examples": [],
        "description": "Array of reference video URLs (mp4/mov). Max 4 items.",
        "field": "videos_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Videos",
        "name": "videos_list",
        "maxItems": 4
      },
      "image_url": {
        "examples": [],
        "type": "string",
        "title": "Image Url",
        "name": "image_url",
        "description": "URL to a single reference image.",
        "field": "image"
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
        "description": "Video duration in seconds (2-10).",
        "default": 5,
        "minValue": 2,
        "maxValue": 10
      },
      "negative_prompt": {
        "type": "string",
        "title": "Negative Prompt",
        "name": "negative_prompt",
        "description": "What not to generate",
        "examples": [
          "blurry, low quality, distorted"
        ]
      }
    },
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "seedance-2-i2v-480p",
    "name": "Seedance 2 I2V 480P",
    "endpoint": "seedance-2.0-i2v-480p",
    "family": "sd-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The lightbulb suddenly rockets across the room like a missile, smashing through curtains while water spins violently inside. The fish darts through swirling currents as the bulb ricochets off walls and finally bursts into floating droplets."
        ],
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video animation. Reference uploaded images using @image1, @image2, … @imageN (1-based, matching images_list order). To use a fictional character, reference it with @character:<id> (request_id from a completed Seedance 2 Character generation) — characters are automatically appended to images_list. Multiple characters are supported."
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-i2v.jpg"
        ],
        "description": "Upload up to 9 image URLs. Reference them in the prompt using @image1, @image2, … @image9.",
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
    "id": "seedance-2-omni-reference-480p",
    "name": "Seedance 2 Omni Reference 480P",
    "endpoint": "seedance-2.0-omni-reference-480p",
    "family": "sd-v2.0",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "@image1 is the main character reference. A person walking on the beach at sunset, cinematic lighting"
        ],
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, @audio1…@audio3 for audio. To use a fictional character, reference it with @character:<id> (request_id from a completed Seedance 2 Character generation) — characters are automatically appended to images_list. Multiple characters are supported."
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-omni-reference.png"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Output video aspect ratio."
      },
      "quality": {
        "enum": [
          "high",
          "basic"
        ],
        "title": "Quality",
        "name": "quality",
        "type": "string",
        "default": "basic",
        "description": "Generation quality. 'high' uses the standard model ($0.24/sec output + $0.072/sec per input video second). 'basic' uses the fast model ($0.18/sec output + $0.054/sec per input video second). Video reference inputs incur an additional 30% surcharge based on their combined duration."
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds (8–15).",
        "default": 8,
        "minValue": 8,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-2-image-to-video",
    "name": "Seedance 2",
    "endpoint": "seedance-2-image-to-video",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video animation. Use @character:<id> to reference a completed Seedance 2 Character generation.",
        "examples": [
          "The person walks forward with a smile."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image uses it as the start frame (first_last_frames mode). 2–9 images switches to omni_reference mode — reference them in your prompt with @image1, @image2, etc.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
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
    "id": "seedance-2-image-to-video-fast",
    "name": "Seedance 2 Image to Video Fast",
    "endpoint": "seedance-2-image-to-video-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video animation. Use @character:<id> to reference a completed Seedance 2 Character generation.",
        "examples": [
          "The person walks forward with a smile."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image uses it as the start frame (first_last_frames mode). 2–9 images switches to omni_reference mode — reference them in your prompt with @image1, @image2, etc.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
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
    "id": "seedance-2-first-last-frame",
    "name": "Seedance 2 First Last Frame",
    "endpoint": "seedance-2-first-last-frame",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the transition between frames.",
        "examples": [
          "Two people having a street interview, the interviewer holds a microphone."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame only; 2 images = first and last frame. Use 'adaptive' aspect ratio to match the reference image geometry.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
      },
      "aspect_ratio": {
        "enum": [
          "adaptive",
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
        "description": "Output video aspect ratio. 'adaptive' matches the reference image (recommended); concrete ratios may crop or pad.",
        "default": "adaptive"
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
    "id": "seedance-2-first-last-frame-fast",
    "name": "Seedance 2 First Last Frame Fast",
    "endpoint": "seedance-2-first-last-frame-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the transition between frames.",
        "examples": [
          "Two people having a street interview, the interviewer holds a microphone."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame only; 2 images = first and last frame. Use 'adaptive' aspect ratio to match the reference image geometry.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
      },
      "aspect_ratio": {
        "enum": [
          "adaptive",
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
        "description": "Output video aspect ratio. 'adaptive' matches the reference image (recommended); concrete ratios may crop or pad.",
        "default": "adaptive"
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
    "id": "seedance-2-omni-reference-no-video",
    "name": "Seedance 2 Omni Reference No Video",
    "endpoint": "seedance-2-omni-reference-no-video",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images and @audio1…@audio3 for audio. To use a character sheet, reference it with @character:<request_id> (from a completed Seedance 2 Character generation). To use a trained Omni Reference character, reference it with @omni-character:<character_id> where character_id is the value returned by Omni Reference Train Character (e.g. char_1775422630065_4vbana). Both methods can be combined in the same prompt. Multiple characters are supported. Example: '@omni-character:char_1775422630065_4vbana walking through a neon-lit city at night'.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "minItems": 1,
        "maxItems": 9
      },
      "audio_files": {
        "examples": [],
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Output video aspect ratio."
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
    "id": "seedance-2-omni-reference-no-video-fast",
    "name": "Seedance 2 Omni Reference No Video Fast",
    "endpoint": "seedance-2-omni-reference-no-video-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images and @audio1…@audio3 for audio. To use a character sheet, reference it with @character:<request_id> (from a completed Seedance 2 Character generation). To use a trained Omni Reference character, reference it with @omni-character:<character_id> where character_id is the value returned by Omni Reference Train Character (e.g. char_1775422630065_4vbana). Both methods can be combined in the same prompt. Multiple characters are supported. Example: '@omni-character:char_1775422630065_4vbana walking through a neon-lit city at night'.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "minItems": 1,
        "maxItems": 9
      },
      "audio_files": {
        "examples": [],
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
          "16:9",
          "9:16",
          "4:3",
          "3:4"
        ],
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "type": "string",
        "default": "16:9",
        "description": "Output video aspect ratio."
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
    "id": "seedance-2-vip-image-to-video",
    "name": "Seedance 2 VIP",
    "endpoint": "seedance-2-vip-image-to-video",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video animation. Use @character:<id> to reference a completed Seedance 2 Character generation. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "The person walks forward with a smile."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 or 2 images used as start frame (and optional end frame). Provide 1 image to animate from it, or 2 images for a start-to-end transition.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 2
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
    "id": "seedance-2-vip-image-to-video-fast",
    "name": "Seedance 2 VIP Image to Video Fast",
    "endpoint": "seedance-2-vip-image-to-video-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video animation. Use @character:<id> to reference a completed Seedance 2 Character generation. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "The person walks forward with a smile."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 or 2 images used as start frame (and optional end frame).",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 2
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
    "id": "seedance-2-vip-first-last-frame",
    "name": "Seedance 2 VIP First Last Frame",
    "endpoint": "seedance-2-vip-first-last-frame",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the transition between frames.",
        "examples": [
          "Two people having a street interview, the interviewer holds a microphone."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame only; 2 images = first and last frame. Use 'adaptive' aspect ratio to match the reference image geometry.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
      },
      "aspect_ratio": {
        "enum": [
          "adaptive",
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
        "description": "Output video aspect ratio. 'adaptive' matches the reference image (recommended); concrete ratios may crop or pad.",
        "default": "adaptive"
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
    "id": "seedance-2-vip-first-last-frame-fast",
    "name": "Seedance 2 VIP First Last Frame Fast",
    "endpoint": "seedance-2-vip-first-last-frame-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the transition between frames.",
        "examples": [
          "Two people having a street interview, the interviewer holds a microphone."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame only; 2 images = first and last frame. Use 'adaptive' aspect ratio to match the reference image geometry.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
      },
      "aspect_ratio": {
        "enum": [
          "adaptive",
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
        "description": "Output video aspect ratio. 'adaptive' matches the reference image (recommended); concrete ratios may crop or pad.",
        "default": "adaptive"
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
    "id": "seedance-2-vip-omni-reference",
    "name": "Seedance 2 VIP Omni Reference",
    "endpoint": "seedance-2-vip-omni-reference",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, and @audio1…@audio3 for audio. Use @character:<request_id> for a Seedance 2 character sheet or @omni-character:<char_id> for a trained Kinovi character. Multiple characters are supported.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
    "id": "seedance-2-vip-omni-reference-fast",
    "name": "Seedance 2 VIP Omni Reference Fast",
    "endpoint": "seedance-2-vip-omni-reference-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, and @audio1…@audio3 for audio. Use @character:<request_id> for a Seedance 2 character sheet or @omni-character:<char_id> for a trained Kinovi character. Multiple characters are supported.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
    "id": "happy-horse-1-image-to-video-1080p",
    "name": "Happy Horse 1 Image to Video 1080P",
    "endpoint": "happy-horse-1-image-to-video-1080p",
    "family": "happy-horse-1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the motion.",
        "examples": [
          "A tiny horse wearing boxing gloves stands in front of a massive battle robot in the middle of a city street. The horse suddenly charges fearlessly and punches the robot so hard that cars flip over and nearby windows shatter from the impact shockwave."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-image-to-video-1080p.jpg"
        ],
        "description": "Upload or provide the image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
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
    "id": "happy-horse-1-image-to-video-720p",
    "name": "Happy Horse 1 Image to Video 720P",
    "endpoint": "happy-horse-1-image-to-video-720p",
    "family": "happy-horse-1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the motion.",
        "examples": [
          "The motorcycle suddenly accelerates uncontrollably through traffic while the horse struggles to stay balanced. Cars swerve out of the way, sparks scrape across the road during sharp turns, and the camera tracks inches away from the speeding bike."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-image-to-video-720p.jpg"
        ],
        "description": "Upload or provide the image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
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
    "id": "veo-4-image-to-video",
    "name": "Veo 4",
    "endpoint": "veo-4-image-to-video",
    "family": "veo-4",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Upload or provide the image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
      },
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the motion and camera movement.",
        "examples": [
          "Camera slowly pans left, parallax depth, cinematic lighting."
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
    "id": "seedance-2-vip-image-to-video-1080p",
    "name": "Seedance 2 VIP Image to Video 1080P",
    "endpoint": "sd-2-vip-image-to-video-1080p",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-i2v.jpg"
        ],
        "description": "Upload or provide the start frame image.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
      },
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the video motion.",
        "examples": [
          "Slow cinematic pan, dramatic lighting shift."
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
    "id": "seedance-2-vip-image-to-video-fast-1080p",
    "name": "Seedance 2 VIP Image to Video Fast 1080P",
    "endpoint": "sd-2-vip-image-to-video-fast-1080p",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-i2v.jpg"
        ],
        "description": "Upload or provide the start frame image.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
      },
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the video motion.",
        "examples": [
          "Slow cinematic pan, dramatic lighting shift."
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
    "id": "seedance-2-vip-omni-reference-1080p",
    "name": "Seedance 2 VIP Omni Reference 1080P",
    "endpoint": "sd-2-vip-omni-reference-1080p",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, and @audio1…@audio3 for audio. Use @character:<request_id> for a Seedance 2 character sheet or @omni-character:<char_id> for a trained Kinovi character. Multiple characters are supported.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
    "id": "seedance-2-vip-omni-reference-fast-1080p",
    "name": "Seedance 2 VIP Omni Reference Fast 1080P",
    "endpoint": "sd-2-vip-omni-reference-fast-1080p",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, and @audio1…@audio3 for audio. Use @character:<request_id> for a Seedance 2 character sheet or @omni-character:<char_id> for a trained Kinovi character. Multiple characters are supported.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
    "id": "seedance-2-vip-first-last-frame-1080p",
    "name": "Seedance 2 VIP First Last Frame 1080P",
    "endpoint": "sd-2-vip-first-last-frame-1080p",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the transition between frames.",
        "examples": [
          "Two people having a street interview, the interviewer holds a microphone."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame only; 2 images = first and last frame. Use 'adaptive' aspect ratio to match the reference image geometry.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
      },
      "aspect_ratio": {
        "enum": [
          "adaptive",
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
        "description": "Output video aspect ratio. 'adaptive' matches the reference image (recommended); concrete ratios may crop or pad.",
        "default": "adaptive"
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
    "id": "kling-v3.0-4k-image-to-video",
    "name": "Kling v3.0 4K",
    "endpoint": "kling-v3.0-4k-image-to-video",
    "family": "kling-v3.0",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The camera begins on the railway station platform beside a stationary train as morning sunlight filters through the roof. Passengers make small natural movements while the train doors are open. The camera moves forward and enters the train, transitioning smoothly into a window-seat point of view. As the doors close, the train starts moving. The view shifts fully to the window, showing the city passing by outside with gentle motion blur, buildings and trees sliding past. Sunlight reflects on the glass, faint interior reflections appear, and the ride feels calm and realistic with smooth, cinematic motion."
        ],
        "description": "Text prompt describing the video.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/kling-v3.0-pro-image-to-video1.jpg"
        ],
        "description": "URL of the input image used to generate video.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
      },
      "last_image": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/kling-v3.0-pro-image-to-video2.jpg"
        ],
        "description": "URL of the input last image.",
        "field": "image",
        "type": "string",
        "title": "Last Image",
        "name": "last_image"
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
    "id": "vidu-q3-pro-image-to-video",
    "name": "Vidu Q3 Pro",
    "endpoint": "vidu-q3-pro-image-to-video",
    "family": "vidu-q3-pro",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The floating train suddenly accelerates violently through the sky while sections of the track collapse behind it. Sparks explode beneath the wheels as the camera races alongside the train through tight gaps between skyscrapers. Pieces of the city break apart during the chase."
        ],
        "description": "Text prompt describing the motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q3-pro-image-to-video.jpg"
        ],
        "description": "URL of the starting frame image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
    "id": "vidu-q3-pro-first-last-frames",
    "name": "Vidu Q3 Pro First Last Frames",
    "endpoint": "vidu-q3-pro-first-last-frames",
    "family": "vidu-q3-pro",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The frozen bird begins cracking from within as glowing orange light shines through the ice. Steam bursts outward while flames ignite across the wings. The sculpture violently shatters apart and transforms into a blazing phoenix that launches upward through fire and smoke."
        ],
        "description": "Text prompt describing the transition.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q3-pro-first-last-frames-1.jpg"
        ],
        "description": "URL of the starting (first) frame image.",
        "field": "image",
        "type": "string",
        "title": "First Image URL",
        "name": "image_url"
      },
      "last_image": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q3-pro-first-last-frames-2.jpg"
        ],
        "description": "URL of the ending (last) frame image.",
        "field": "image",
        "type": "string",
        "title": "Last Image URL",
        "name": "last_image"
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
    "id": "vidu-q3-turbo-image-to-video",
    "name": "Vidu Q3 Turbo",
    "endpoint": "vidu-q3-turbo-image-to-video",
    "family": "vidu-q3-turbo",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The shark crashes through moving traffic, flipping cars into the air while water bursts across the highway. The camera races alongside the destruction as vehicles spin and explode behind the creature."
        ],
        "description": "Text prompt describing the motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q3-turbo-image-to-video.jpg"
        ],
        "description": "URL of the starting frame image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
    "id": "vidu-q3-turbo-first-last-frames",
    "name": "Vidu Q3 Turbo First Last Frames",
    "endpoint": "vidu-q3-turbo-first-last-frames",
    "family": "vidu-q3-turbo",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "Dark smoke begins leaking from the woman’s body and rapidly expands outward. Her form dissolves into swirling vapor while glowing eyes emerge from the smoke cloud. The alley fills with violent rotating smoke as the camera circles aggressively around the transformation."
        ],
        "description": "Text prompt describing the transition.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q3-turbo-first-last-frames-1.jpg"
        ],
        "description": "URL of the starting (first) frame image.",
        "field": "image",
        "type": "string",
        "title": "First Image URL",
        "name": "image_url"
      },
      "last_image": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q3-turbo-first-last-frames-2.jpg"
        ],
        "description": "URL of the ending (last) frame image.",
        "field": "image",
        "type": "string",
        "title": "Last Image URL",
        "name": "last_image"
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
    "id": "vidu-q2-pro-image-to-video",
    "name": "Vidu Q2 Pro",
    "endpoint": "vidu-q2-pro-image-to-video",
    "family": "vidu-q2",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The subject turns toward the camera as warm sunlight drifts across their face. The camera pushes in slowly while wind moves through their hair."
        ],
        "description": "Text prompt describing the motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q2-turbo-1.jpg"
        ],
        "description": "URL of the starting frame image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
        "description": "Aspect ratio of the output video. Match this to your source image to avoid cropping.",
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
    "id": "vidu-q2-turbo-image-to-video",
    "name": "Vidu Q2 Turbo",
    "endpoint": "vidu-q2-turbo-image-to-video",
    "family": "vidu-q2",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "The subject smiles softly as the camera slowly orbits around them. Warm rim light catches the edges of their hair."
        ],
        "description": "Text prompt describing the motion.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/vidu-q2-turbo-1.jpg"
        ],
        "description": "URL of the starting frame image.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
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
        "description": "Aspect ratio of the output video. Match this to your source image to avoid cropping.",
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
    "id": "happy-horse-1-reference-to-video-1080p",
    "name": "Happy Horse 1 Reference to Video 1080P",
    "endpoint": "happy-horse-1-reference-to-video-1080p",
    "family": "happy-horse-1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video. Up to 5,000 non-Chinese (or 2,500 Chinese) characters.",
        "examples": [
          "Place @image1 inside @image2 running across countertops while giant cooking disasters happen everywhere. Exploding soup pots, flying vegetables, and fire bursts create chaos as the tiny horse desperately escapes through the oversized kitchen."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-1080p-1.jpg",
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-1080p-2.jpg"
        ],
        "description": "1-9 reference image URLs. JPEG/PNG/WEBP, >=400px shortest side, <=10 MB each.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
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
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Optional random seed for reproducibility (0-2147483647).",
        "default": 0,
        "minValue": 0,
        "maxValue": 2147483647,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1-reference-to-video-720p",
    "name": "Happy Horse 1 Reference to Video 720P",
    "endpoint": "happy-horse-1-reference-to-video-720p",
    "family": "happy-horse-1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video. Up to 5,000 non-Chinese (or 2,500 Chinese) characters.",
        "examples": [
          "Use @image1 riding inside @image2 at extreme speed through a massive supermarket. The rocket cart blasts through aisles, launches over checkout counters, and sends products exploding everywhere while the camera chases closely behind through the chaos."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-720p-1.jpg",
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-720p-2.jpg"
        ],
        "description": "1-9 reference image URLs. JPEG/PNG/WEBP, >=400px shortest side, <=10 MB each.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
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
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Optional random seed for reproducibility (0-2147483647).",
        "default": 0,
        "minValue": 0,
        "maxValue": 2147483647,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "gemini-omni-image-to-video",
    "name": "Gemini Omni",
    "endpoint": "gemini-omni-image-to-video",
    "family": "gemini-omni",
    "imageField": "image_urls",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired motion and scene. Gemini Omni supports rich multimodal prompts including camera direction, dialogue, and ambient audio cues.",
        "examples": [
          "The suitcase opens by itself and tiny landscapes start unfolding out of it—mountains, forests, oceans, entire cities. Each world expands outward onto the platform, growing larger and larger while miniature weather systems form above them."
        ]
      },
      "image_urls": {
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "image_urls",
        "description": "Upload 1–7 reference images for the video. Maximum 20 MB each.",
        "examples": [
          "https://cdn.muapi.ai/assets/gemini-omni-image-to-video.jpg"
        ],
        "maxItems": 7
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
    "id": "grok-imagine-video-1-5-preview",
    "name": "Grok Imagine Video 1.5 Preview",
    "endpoint": "grok-imagine-video-1-5-preview",
    "family": "video-generation",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description for video generation.",
        "examples": [
          "The whale suddenly begins swimming through the apartment as if the room is underwater. Furniture crashes into walls, water bursts outward, and the whale breaks through multiple rooms while the camera follows beside it."
        ]
      },
      "images_list": {
        "examples": [
          "https://cdn.muapi.ai/assets/grok-imagine-video-1-5-preview.jpg"
        ],
        "description": "Upload or provide image URLs to use as input for video generation.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 1
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
          "2:3"
        ],
        "type": "string",
        "title": "Aspect Ratio",
        "name": "aspect_ratio",
        "description": "Aspect ratio for the generated video. Use 'auto' to match the input image.",
        "default": "auto"
      },
      "resolution": {
        "enum": [
          "480p",
          "720p"
        ],
        "type": "string",
        "title": "Resolution",
        "name": "resolution",
        "description": "Output video resolution.",
        "default": "480p"
      },
      "duration": {
        "type": "int",
        "title": "Duration (seconds)",
        "name": "duration",
        "description": "Video duration in seconds.",
        "default": 8,
        "minValue": 1,
        "maxValue": 15,
        "step": 1
      }
    },
    "provider": "grok",
    "provider_name": "xAI"
  },
  {
    "id": "kling-v3-turbo-standard-image-to-video",
    "name": "Kling v3 Turbo Standard",
    "endpoint": "kling-v3-turbo-standard-image-to-video",
    "family": "kling-v3.0",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "The kitchen explodes into chaos as soup erupts upward, giant vegetables crash across the counter, and flames burst from the stove. The tiny astronaut sprints between falling objects while the camera follows inches behind."
        ]
      },
      "image_url": {
        "type": "string",
        "title": "Image URL",
        "name": "image_url",
        "description": "URL of the input image used to generate video.",
        "field": "image",
        "examples": [
          "https://cdn.muapi.ai/assets/kling-v3-turbo-standard-image-to-video.jpg"
        ]
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
    "id": "kling-v3-turbo-pro-image-to-video",
    "name": "Kling v3 Turbo Pro",
    "endpoint": "kling-v3-turbo-pro-image-to-video",
    "family": "kling-v3.0",
    "imageField": "image_url",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text prompt describing the video.",
        "examples": [
          "Cracks spread rapidly through the ice before it explodes outward in massive shards. The titan awakens violently, roaring as it tears itself free and sends snowstorms spiraling outward. The camera circles aggressively during the awakening."
        ]
      },
      "image_url": {
        "type": "string",
        "title": "Image URL",
        "name": "image_url",
        "description": "URL of the input image used to generate video.",
        "field": "image",
        "examples": [
          "https://cdn.muapi.ai/assets/kling-v3-turbo-pro-image-to-video.jpg"
        ]
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
    "id": "seedance-2.1-image-to-video",
    "name": "Seedance 2.1",
    "endpoint": "seedance-2.1-image-to-video",
    "family": "seedance-2.1",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "Add a slow cinematic orbit around the subject, gentle parallax depth, fog drifting naturally, sky colors shifting while preserving original lighting and mood."
        ],
        "description": "Text prompt describing the video motion and style.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v1.5-pro-i2v.jpg"
        ],
        "description": "URL of the input image to animate into video.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
      },
      "last_image": {
        "examples": [
          null
        ],
        "description": "Optional URL of the last frame image for first-last frame control.",
        "field": "image",
        "type": "string",
        "title": "Last Image",
        "name": "last_image"
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
    "id": "seedance-2.5-image-to-video",
    "name": "Seedance 2.5",
    "endpoint": "seedance-2.5-image-to-video",
    "family": "seedance-2.5",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "Cinematic slow dolly forward through a surreal neon cityscape at night, rain-slicked streets reflecting towers of light, shallow depth of field, photorealistic 4K quality."
        ],
        "description": "Text prompt describing the video motion and style.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v1.5-pro-i2v.jpg"
        ],
        "description": "URL of the input image to animate into video.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
      },
      "last_image": {
        "examples": [
          null
        ],
        "description": "Optional URL of the last frame image for first-last frame control.",
        "field": "image",
        "type": "string",
        "title": "Last Image",
        "name": "last_image"
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
    "id": "seedance-2-mini-image-to-video",
    "name": "Seedance 2 Mini",
    "endpoint": "seedance-2-mini-image-to-video",
    "family": "seedance-2.0-mini",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "A slow cinematic push toward a subject on a sunlit rooftop, gentle breeze in the hair."
        ],
        "description": "Text prompt guiding the video animation.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v1.5-pro-i2v.jpg"
        ],
        "description": "1 image = start frame. 2-9 images = reference images; reference them in your prompt with @image1, @image2, etc.",
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
    "id": "happy-horse-1.1-image-to-video-1080p",
    "name": "Happy Horse 1.1 Image to Video 1080P",
    "endpoint": "happy-horse-1.1-image-to-video-1080p",
    "family": "happy-horse-1.1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the motion.",
        "examples": [
          "A tiny horse wearing boxing gloves stands in front of a massive battle robot. The horse suddenly charges fearlessly and punches the robot so hard that cars flip over."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-image-to-video-1080p.jpg"
        ],
        "description": "Upload or provide the image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
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
    "id": "happy-horse-1.1-image-to-video-720p",
    "name": "Happy Horse 1.1 Image to Video 720P",
    "endpoint": "happy-horse-1.1-image-to-video-720p",
    "family": "happy-horse-1.1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the motion.",
        "examples": [
          "A tiny horse wearing boxing gloves stands in front of a massive battle robot. The horse suddenly charges fearlessly and punches the robot so hard that cars flip over."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-image-to-video-1080p.jpg"
        ],
        "description": "Upload or provide the image to animate.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
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
    "id": "happy-horse-1.1-reference-to-video-1080p",
    "name": "Happy Horse 1.1 Reference to Video 1080P",
    "endpoint": "happy-horse-1.1-reference-to-video-1080p",
    "family": "happy-horse-1.1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video. Up to 5,000 characters.",
        "examples": [
          "Place @image1 inside @image2 running across countertops while giant cooking disasters happen everywhere. Exploding soup pots, flying vegetables, and fire bursts create chaos."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-1080p-1.jpg",
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-1080p-2.jpg"
        ],
        "description": "1-9 reference image URLs. JPEG/PNG/WEBP, >=400px shortest side, <=10 MB each.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
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
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Optional random seed for reproducibility (0-2147483647).",
        "default": 0,
        "minValue": 0,
        "maxValue": 2147483647,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1.1-reference-to-video-720p",
    "name": "Happy Horse 1.1 Reference to Video 720P",
    "endpoint": "happy-horse-1.1-reference-to-video-720p",
    "family": "happy-horse-1.1",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description of the desired video. Up to 5,000 characters.",
        "examples": [
          "Place @image1 inside @image2 running across countertops while giant cooking disasters happen everywhere. Exploding soup pots, flying vegetables, and fire bursts create chaos."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-1080p-1.jpg",
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/happy-horse-1-reference-to-video-1080p-2.jpg"
        ],
        "description": "1-9 reference image URLs. JPEG/PNG/WEBP, >=400px shortest side, <=10 MB each.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 9
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
      },
      "seed": {
        "type": "int",
        "title": "Seed",
        "name": "seed",
        "description": "Optional random seed for reproducibility (0-2147483647).",
        "default": 0,
        "minValue": 0,
        "maxValue": 2147483647,
        "step": 1
      }
    },
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "seedance-2-vip-image-to-video-4k",
    "name": "Seedance 2 VIP Image to Video 4K",
    "endpoint": "sd-2-vip-image-to-video-4k",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v2.0-i2v.jpg"
        ],
        "description": "Upload or provide the start frame image.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image",
        "name": "images_list",
        "maxItems": 1
      },
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Optional text description guiding the video motion.",
        "examples": [
          "Slow cinematic pan, dramatic lighting shift."
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
    "id": "seedance-2-vip-first-last-frame-4k",
    "name": "Seedance 2 VIP First Last Frame 4K",
    "endpoint": "sd-2-vip-first-last-frame-4k",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the transition between frames.",
        "examples": [
          "Two people having a street interview, the interviewer holds a microphone."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 image = first frame only; 2 images = first and last frame. Use ‘adaptive’ aspect ratio to match the reference image geometry.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Frame Images",
        "name": "images_list",
        "maxItems": 2
      },
      "aspect_ratio": {
        "enum": [
          "adaptive",
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
        "description": "Output video aspect ratio. ‘adaptive’ matches the reference image (recommended); concrete ratios may crop or pad.",
        "default": "adaptive"
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
    "id": "seedance-2-vip-omni-reference-4k",
    "name": "Seedance 2 VIP Omni Reference 4K",
    "endpoint": "sd-2-vip-omni-reference-4k",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Video description. Use @image1…@image9 to reference images, @video1…@video3 for videos, and @audio1…@audio3 for audio. Use @character:<request_id> for a Seedance 2 character sheet or @omni-character:<char_id> for a trained Kinovi character. Multiple characters are supported.",
        "examples": [
          "@image1 is the main character. The person walks along a city street at sunset, cinematic lighting."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "Up to 9 reference image URLs (JPEG/PNG/WebP). Each Nth image corresponds to @imageN in the prompt.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Image URLs",
        "name": "images_list",
        "maxItems": 9
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
        "description": "Up to 3 reference audio files (MP3/WAV, total max 15s). Each Nth audio corresponds to @audioN in the prompt.",
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
    "id": "seedance-2.5-spicy-image-to-video",
    "name": "Seedance 2.5 Spicy",
    "endpoint": "seedance-2.5-spicy-image-to-video",
    "family": "seedance-2.5",
    "imageField": "image_url",
    "lastImageField": "last_image",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "Bold, high-energy dolly forward through a neon-drenched alley at night, sparks flying off a passing train, exaggerated lighting contrast, dramatic camera shake, photorealistic 4K quality."
        ],
        "description": "Text prompt describing the video motion and style. Spicy mode favors bolder, higher-contrast, more expressive results.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "image_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v1.5-pro-i2v.jpg"
        ],
        "description": "URL of the input image to animate into video.",
        "field": "image",
        "type": "string",
        "title": "Image URL",
        "name": "image_url"
      },
      "last_image": {
        "examples": [
          null
        ],
        "description": "Optional URL of the last frame image for first-last frame control.",
        "field": "image",
        "type": "string",
        "title": "Last Image",
        "name": "last_image"
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
    "id": "seedance-2-spicy-image-to-video",
    "name": "Seedance 2 Spicy",
    "endpoint": "seedance-2-spicy-image-to-video",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video animation. Use @character:<id> to reference a completed Seedance 2 Character generation. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "The person walks forward with a smile."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 or 2 images used as start frame (and optional end frame). Provide 1 image to animate from it, or 2 images for a start-to-end transition.",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 2
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
    "id": "seedance-2-spicy-image-to-video-fast",
    "name": "Seedance 2 Spicy Image to Video Fast",
    "endpoint": "seedance-2-spicy-image-to-video-fast",
    "family": "sd-2",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Text description guiding the video animation. Use @character:<id> to reference a completed Seedance 2 Character generation. Use @omni-character:<char_id> for a trained Kinovi character.",
        "examples": [
          "The person walks forward with a smile."
        ]
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-images/186/712345784292/4a8c5c70-abcc-4920-873e-b0e219986453.jpg"
        ],
        "description": "1 or 2 images used as start frame (and optional end frame).",
        "field": "images_list",
        "type": "array",
        "items": {
          "type": "string"
        },
        "title": "Reference Images",
        "name": "images_list",
        "maxItems": 2
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
    "id": "seedance-2-mini-spicy-image-to-video",
    "name": "Seedance 2 Mini Spicy",
    "endpoint": "seedance-2-mini-spicy-image-to-video",
    "family": "seedance-2.0-mini",
    "imageField": "images_list",
    "hasPrompt": true,
    "inputs": {
      "prompt": {
        "examples": [
          "A slow cinematic push toward a subject on a sunlit rooftop, gentle breeze in the hair."
        ],
        "description": "Text prompt guiding the video animation.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "images_list": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/seedance-v1.5-pro-i2v.jpg"
        ],
        "description": "1 image = start frame. 2-9 images = reference images; reference them in your prompt with @image1, @image2, etc.",
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

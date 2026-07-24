/**
 * marketer.sh Studio model catalog — Audio models (speech, music, sound effects, voice cloning).
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 16 models.
 */
import type { ModelDefinition } from '../types';

export const audioModels: ModelDefinition[] = [
  {
    "id": "suno-create-music",
    "name": "Suno Create Music",
    "endpoint": "suno-create-music",
    "family": "suno",
    "description": "Suno generate music that turns text prompts into full songs ΓÇö complete with vocals, lyrics, and instrumentation. You can describe a mood, genre, or even a specific lyric idea, and Suno creates a realistic, studio-quality track in seconds.",
    "required": [
      "style"
    ],
    "inputs": {
      "prompt": {
        "examples": [
          "Hard-hitting rap track with aggressive beat and confident male vocals about winning."
        ],
        "description": "A description of the desired audio content. The prompt will be strictly used as the lyrics and sung in the generated track",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "style": {
        "examples": [
          "Classical"
        ],
        "description": "Music style specification for the generated audio.",
        "format": "text",
        "type": "string",
        "title": "Style",
        "name": "style",
        "placeholder": "Jazz, Classical, Electronic, Pop, Rock, Hip-hop, etc."
      },
      "model": {
        "enum": [
          "V3_5",
          "V4",
          "V4_5",
          "V4_5PLUS",
          "V4_5ALL",
          "V5",
          "V5_5"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "The AI model version to use for generation.",
        "default": "V5"
      },
      "custom_mode": {
        "type": "boolean",
        "title": "Custom Mode",
        "name": "custom_mode",
        "description": "Enable custom mode for advanced settings.",
        "default": true
      },
      "title": {
        "type": "string",
        "title": "Title",
        "name": "title",
        "description": "Title for the generated music track (optional).",
        "placeholder": "Peaceful Piano Meditation"
      },
      "persona_id": {
        "type": "string",
        "title": "Persona ID",
        "name": "persona_id",
        "description": "Persona ID or custom voice ID to apply to the generated music (optional). Pair with persona_model to disambiguate."
      },
      "persona_model": {
        "enum": [
          "style_persona",
          "voice_persona"
        ],
        "type": "string",
        "title": "Persona Model",
        "name": "persona_model",
        "description": "What kind of persona_id this is. Set to voice_persona when persona_id is a cloned voice ID from suno-voice-clone. Requires model V5 or V5_5."
      },
      "instrumental": {
        "type": "boolean",
        "title": "Instrumental",
        "name": "instrumental",
        "description": "Enable this option to generate music without prompt. If false prompt will used as the exact lyrics.",
        "default": true
      },
      "negative_tags": {
        "examples": [
          null
        ],
        "title": "Negative Tags",
        "name": "negative_tags",
        "type": "string",
        "format": "text",
        "description": "Music styles or traits to exclude from the generated audio (optional). Use to avoid specific styles.",
        "placeholder": "Heavy Metal, Upbeat Drums"
      },
      "vocal_gender": {
        "enum": [
          "male",
          "female"
        ],
        "title": "Vocal Gender",
        "name": "vocal_gender",
        "type": "string",
        "description": "Vocal gender preference for the singing voice (optional).",
        "default": "male"
      },
      "style_weight": {
        "title": "Style Weight",
        "name": "style_weight",
        "type": "int",
        "description": "Strength of adherence to the specified style (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "weirdness_constraint": {
        "title": "Weirdness Constraint",
        "name": "weirdness_constraint",
        "type": "int",
        "description": "Controls experimental/creative deviation (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "audio_weight": {
        "title": "Audio Weight",
        "name": "audio_weight",
        "type": "int",
        "description": "Balance weight for audio features vs. other factors (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      }
    }
  },
  {
    "id": "suno-remix-music",
    "name": "Suno Remix Music",
    "endpoint": "suno-remix-music",
    "family": "suno",
    "description": "This API covers an audio track by transforming it into a new style while retaining its core melody. It incorporates Suno's upload capability, enabling users to upload an audio file for processing. The expected result is a refreshed audio track with a new style, keeping the original melody intact.",
    "required": [
      "audio_url",
      "style"
    ],
    "inputs": {
      "prompt": {
        "examples": [
          "A calm and relaxing piano track with soft melodies"
        ],
        "description": "A description of the desired audio content. The prompt will be strictly used as the lyrics and sung in the generated track. Maximum 3000 characters",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "audio_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/ai-music/186/309018126238/c7e634cf-f0f3-4988-8225-4e7d0eb6121b.mp3"
        ],
        "description": "The URL for uploading audio files. Ensure the uploaded audio does not exceed 2 minutes in length.",
        "field": "audio",
        "type": "string",
        "title": "Audio URL",
        "name": "audio_url"
      },
      "style": {
        "examples": [
          "Classical"
        ],
        "description": "Music style specification for the generated audio.",
        "format": "text",
        "type": "string",
        "title": "Style",
        "name": "style",
        "placeholder": "Jazz, Classical, Electronic, Pop, Rock, Hip-hop, etc."
      },
      "model": {
        "enum": [
          "V3_5",
          "V4",
          "V4_5",
          "V4_5PLUS",
          "V4_5ALL",
          "V5",
          "V5_5"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "The AI model version to use for generation.",
        "default": "V5"
      },
      "custom_mode": {
        "type": "boolean",
        "title": "Custom Mode",
        "name": "custom_mode",
        "description": "Enable custom mode for advanced settings.",
        "default": true
      },
      "title": {
        "type": "string",
        "title": "Title",
        "name": "title",
        "description": "Title for the generated music track (optional).",
        "placeholder": "Peaceful Piano Meditation"
      },
      "persona_id": {
        "type": "string",
        "title": "Persona ID",
        "name": "persona_id",
        "description": "Persona ID or custom voice ID to apply to the generated music (optional). Pair with persona_model to disambiguate."
      },
      "persona_model": {
        "enum": [
          "style_persona",
          "voice_persona"
        ],
        "type": "string",
        "title": "Persona Model",
        "name": "persona_model",
        "description": "What kind of persona_id this is. Set to voice_persona when persona_id is a cloned voice ID from suno-voice-clone. Requires model V5 or V5_5."
      },
      "instrumental": {
        "type": "boolean",
        "title": "Instrumental",
        "name": "instrumental",
        "description": "Enable this option to generate music without prompt. If false prompt will used as the exact lyrics.",
        "default": true
      },
      "negative_tags": {
        "examples": [
          null
        ],
        "title": "Negative Tags",
        "name": "negative_tags",
        "type": "string",
        "format": "text",
        "description": "Music styles or traits to exclude from the generated audio (optional). Use to avoid specific styles.",
        "placeholder": "Heavy Metal, Upbeat Drums"
      },
      "vocal_gender": {
        "enum": [
          "male",
          "female"
        ],
        "title": "Vocal Gender",
        "name": "vocal_gender",
        "type": "string",
        "description": "Vocal gender preference for the singing voice (optional).",
        "default": "male"
      },
      "style_weight": {
        "title": "Style Weight",
        "name": "style_weight",
        "type": "int",
        "description": "Strength of adherence to the specified style (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "weirdness_constraint": {
        "title": "Weirdness Constraint",
        "name": "weirdness_constraint",
        "type": "int",
        "description": "Controls experimental/creative deviation (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "audio_weight": {
        "title": "Audio Weight",
        "name": "audio_weight",
        "type": "int",
        "description": "Balance weight for audio features vs. other factors (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      }
    }
  },
  {
    "id": "suno-extend-music",
    "name": "Suno Extend Music",
    "endpoint": "suno-extend-music",
    "family": "suno",
    "description": "This API extends audio tracks while preserving the original style of the audio track. It includes Suno's upload functionality, allowing users to upload audio files for processing. The expected result is a longer track that seamlessly continues the input style.",
    "required": [
      "prompt",
      "audio_url",
      "style"
    ],
    "inputs": {
      "prompt": {
        "examples": [
          "Extend the music with more relaxing notes"
        ],
        "description": "A description of the desired audio content. The prompt will be strictly used as the lyrics and sung in the generated track. Maximum 3000 characters",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "audio_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/audios/186/755853337445/example.mp3"
        ],
        "description": "The URL for uploading audio files. Ensure the uploaded audio does not exceed 2 minutes in length.",
        "field": "audio",
        "type": "string",
        "title": "Audio URL",
        "name": "audio_url"
      },
      "style": {
        "examples": [
          "Classical"
        ],
        "description": "Music style specification for the generated audio.",
        "format": "text",
        "type": "string",
        "title": "Style",
        "name": "style",
        "placeholder": "Jazz, Classical, Electronic, Pop, Rock, Hip-hop, etc."
      },
      "model": {
        "enum": [
          "V3_5",
          "V4",
          "V4_5",
          "V4_5PLUS",
          "V4_5ALL",
          "V5",
          "V5_5"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "The AI model version to use for generation.",
        "default": "V5"
      },
      "custom_mode": {
        "type": "boolean",
        "title": "Custom Mode",
        "name": "custom_mode",
        "description": "Enable custom mode for advanced settings.",
        "default": true
      },
      "title": {
        "type": "string",
        "title": "Title",
        "name": "title",
        "description": "Title for the generated music track (optional).",
        "placeholder": "Peaceful Piano Meditation"
      },
      "persona_id": {
        "type": "string",
        "title": "Persona ID",
        "name": "persona_id",
        "description": "Persona ID or custom voice ID to apply to the generated music (optional). Pair with persona_model to disambiguate."
      },
      "persona_model": {
        "enum": [
          "style_persona",
          "voice_persona"
        ],
        "type": "string",
        "title": "Persona Model",
        "name": "persona_model",
        "description": "What kind of persona_id this is. Set to voice_persona when persona_id is a cloned voice ID from suno-voice-clone. Requires model V5 or V5_5."
      },
      "continue_at": {
        "title": "Continue At",
        "name": "continue_at",
        "type": "int",
        "description": "The time point (in seconds) from which to start extending the music. Value range: greater than 0 and less than the total duration of the uploaded audio. Specifies the position in the original track where the extension should begin.",
        "default": 1,
        "minValue": 1,
        "maxValue": 60,
        "step": 1
      },
      "instrumental": {
        "type": "boolean",
        "title": "Instrumental",
        "name": "instrumental",
        "description": "Enable this option to generate music without prompt. If false prompt will used as the exact lyrics.",
        "default": true
      },
      "negative_tags": {
        "examples": [
          null
        ],
        "title": "Negative Tags",
        "name": "negative_tags",
        "type": "string",
        "format": "text",
        "description": "Music styles or traits to exclude from the generated audio (optional). Use to avoid specific styles.",
        "placeholder": "Heavy Metal, Upbeat Drums"
      },
      "vocal_gender": {
        "enum": [
          "male",
          "female"
        ],
        "title": "Vocal Gender",
        "name": "vocal_gender",
        "type": "string",
        "description": "Vocal gender preference for the singing voice (optional).",
        "default": "male"
      },
      "style_weight": {
        "title": "Style Weight",
        "name": "style_weight",
        "type": "int",
        "description": "Strength of adherence to the specified style (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "weirdness_constraint": {
        "title": "Weirdness Constraint",
        "name": "weirdness_constraint",
        "type": "int",
        "description": "Controls experimental/creative deviation (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "audio_weight": {
        "title": "Audio Weight",
        "name": "audio_weight",
        "type": "int",
        "description": "Balance weight for audio features vs. other factors (optional). Range 0ΓÇô1, up to 2 decimal places.",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      }
    }
  },
  {
    "id": "suno-generate-sounds",
    "name": "Suno Generate Sounds",
    "endpoint": "suno-generate-sounds",
    "family": "suno",
    "description": "Generate sound effects using Suno chirp-crow model.",
    "required": [
      "prompt"
    ],
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "sounds task type supports up to 500 characters.",
        "examples": [
          "A car passing by"
        ]
      },
      "model": {
        "enum": [
          "V5"
        ],
        "type": "string",
        "title": "Model",
        "name": "model",
        "description": "The model to use",
        "default": "V5"
      },
      "sound_loop": {
        "type": "boolean",
        "title": "Loop",
        "name": "sound_loop",
        "description": "Whether to loop the generated sound.",
        "default": false
      },
      "sound_tempo": {
        "type": "int",
        "title": "Sound Tempo",
        "name": "sound_tempo",
        "description": "Sound tempo",
        "minValue": 1,
        "maxValue": 300,
        "step": 1,
        "default": 1
      },
      "sound_key": {
        "enum": [
          "Any",
          "Cm",
          "C#m",
          "Dm",
          "D#m",
          "Em",
          "Fm",
          "F#m",
          "Gm",
          "G#m",
          "Am",
          "A#m",
          "Bm",
          "C",
          "C#",
          "D",
          "D#",
          "E",
          "F",
          "F#",
          "G",
          "G#",
          "A",
          "A#",
          "B"
        ],
        "type": "string",
        "title": "Sound Key",
        "name": "sound_key",
        "description": "Musical key",
        "default": "Any"
      },
      "grab_lyrics": {
        "type": "boolean",
        "title": "Grab Lyrics",
        "name": "grab_lyrics",
        "description": "Whether to fetch lyric subtitles after generation is completed.",
        "default": false
      }
    }
  },
  {
    "id": "suno-add-vocals",
    "name": "Suno Add Vocals",
    "endpoint": "suno-add-vocals",
    "family": "suno",
    "description": "Add vocals to an instrumental track.",
    "required": [
      "prompt",
      "title",
      "style",
      "audio_url"
    ],
    "inputs": {
      "prompt": {
        "type": "string",
        "title": "Prompt (Lyrics)",
        "name": "prompt",
        "description": "Lyrics to sing",
        "examples": [
          "[Verse 1]\nHello world..."
        ]
      },
      "audio_url": {
        "type": "string",
        "title": "Instrumental Audio",
        "name": "audio_url",
        "description": "URL of instrumental track",
        "field": "audio"
      },
      "style": {
        "type": "string",
        "title": "Style",
        "name": "style",
        "description": "Vocal style",
        "examples": [
          "Pop"
        ]
      },
      "negative_tags": {
        "type": "string",
        "title": "Negative Tags",
        "name": "negative_tags",
        "description": "Excluded styles"
      },
      "model": {
        "enum": [
          "V4",
          "V4_5",
          "V4_5PLUS",
          "V5"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "The AI model version to use.",
        "default": "V5"
      },
      "vocal_gender": {
        "enum": [
          "male",
          "female"
        ],
        "title": "Vocal Gender",
        "name": "vocal_gender",
        "type": "string",
        "description": "Vocal gender preference.",
        "default": "male"
      },
      "style_weight": {
        "title": "Style Weight",
        "name": "style_weight",
        "type": "int",
        "description": "Strength of style adherence (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "weirdness_constraint": {
        "title": "Weirdness Constraint",
        "name": "weirdness_constraint",
        "type": "int",
        "description": "Experimental deviation (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.01,
        "default": 0.65
      },
      "audio_weight": {
        "title": "Audio Weight",
        "name": "audio_weight",
        "type": "int",
        "description": "Balance weight (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.01,
        "default": 0.65
      },
      "title": {
        "type": "string",
        "title": "Title",
        "name": "title",
        "description": "Track title",
        "default": "New Vocal Track"
      }
    }
  },
  {
    "id": "suno-generate-mashup",
    "name": "Suno Geneate Mashup",
    "endpoint": "suno-generate-mashup",
    "family": "suno",
    "description": "Create a mashup using 1-5 audio tracks.",
    "required": [
      "audios_list"
    ],
    "inputs": {
      "audios_list": {
        "type": "array",
        "title": "Mashup Tracks",
        "name": "audios_list",
        "description": "Upload up to 2 audio files to mashup music from multiple audio tracks.",
        "field": "audios_list",
        "items": {
          "type": "string"
        },
        "maxItems": 2
      },
      "prompt": {
        "type": "string",
        "title": "Prompt",
        "name": "prompt",
        "description": "Creative guidance"
      },
      "style": {
        "type": "string",
        "title": "Style",
        "name": "style",
        "description": "Mashup style"
      },
      "instrumental": {
        "type": "boolean",
        "title": "Instrumental",
        "name": "instrumental",
        "description": "If true: Only style is required else style, and prompt are required (with prompt used as the exact lyrics)",
        "default": true
      },
      "model": {
        "enum": [
          "V4",
          "V4_5",
          "V4_5PLUS",
          "V5"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "The AI model version to use.",
        "default": "V5"
      },
      "vocal_gender": {
        "enum": [
          "male",
          "female"
        ],
        "title": "Vocal Gender",
        "name": "vocal_gender",
        "type": "string",
        "description": "Vocal gender preference.",
        "default": "male"
      },
      "style_weight": {
        "title": "Style Weight",
        "name": "style_weight",
        "type": "int",
        "description": "Strength of style adherence (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "weirdness_constraint": {
        "title": "Weirdness Constraint",
        "name": "weirdness_constraint",
        "type": "int",
        "description": "Experimental deviation (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "audio_weight": {
        "title": "Audio Weight",
        "name": "audio_weight",
        "type": "int",
        "description": "Balance weight (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "title": {
        "type": "string",
        "title": "Title",
        "name": "title",
        "description": "Mashup title",
        "default": "New Mashup"
      }
    }
  },
  {
    "id": "suno-add-instrumental",
    "name": "Suno Add Instrumental",
    "endpoint": "suno-add-instrumental",
    "family": "suno",
    "description": "Add instrumental backing to acapella audio.",
    "required": [
      "title",
      "tags",
      "audio_url"
    ],
    "inputs": {
      "audio_url": {
        "type": "string",
        "title": "Vocal Audio",
        "name": "audio_url",
        "description": "URL of vocal track",
        "field": "audio"
      },
      "tags": {
        "type": "string",
        "title": "Tags",
        "name": "tags",
        "description": "Instrumental styles",
        "examples": [
          "Orchestral"
        ]
      },
      "negative_tags": {
        "type": "string",
        "title": "Negative Tags",
        "name": "negative_tags",
        "description": "Excluded styles"
      },
      "model": {
        "enum": [
          "V4",
          "V4_5",
          "V4_5PLUS",
          "V5"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "The AI model version to use.",
        "default": "V5"
      },
      "vocal_gender": {
        "enum": [
          "male",
          "female"
        ],
        "title": "Vocal Gender",
        "name": "vocal_gender",
        "type": "string",
        "description": "Vocal gender preference.",
        "default": "male"
      },
      "style_weight": {
        "title": "Style Weight",
        "name": "style_weight",
        "type": "int",
        "description": "Strength of style adherence (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "weirdness_constraint": {
        "title": "Weirdness Constraint",
        "name": "weirdness_constraint",
        "type": "int",
        "description": "Experimental deviation (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "audio_weight": {
        "title": "Audio Weight",
        "name": "audio_weight",
        "type": "int",
        "description": "Balance weight (0-1).",
        "minValue": 0,
        "maxValue": 1,
        "step": 0.05,
        "default": 0.65
      },
      "title": {
        "type": "string",
        "title": "Title",
        "name": "title",
        "description": "Track title",
        "default": "Instrumental Song"
      }
    }
  },
  {
    "id": "suno-voice-clone",
    "name": "Suno Voice Cloning",
    "endpoint": "suno-voice-clone",
    "family": "suno",
    "description": "Clone your singing voice in two takes for use with Suno music generation. Submit a 10-second sample, then read back a fresh random phrase the system generates (anti-deepfake liveness check), and receive a reusable voice_id you can drop into Suno music creation. Free during preview.",
    "required": [
      "audio_url"
    ],
    "inputs": {
      "audio_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/minimax-voice-clone-in.wav"
        ],
        "description": "URL of a clean 10-second recording of the voice to clone. Mono is fine. The provider extracts a vocal segment between vocal_start_s and vocal_end_s.",
        "field": "audio",
        "type": "string",
        "title": "Voice Sample URL",
        "name": "audio_url"
      },
      "voice_name": {
        "type": "string",
        "title": "Voice Name",
        "name": "voice_name",
        "description": "A short label for your voice, shown in the voice picker (optional).",
        "placeholder": "My Voice"
      },
      "description": {
        "type": "string",
        "title": "Description",
        "name": "description",
        "description": "Free-form description of this voice (optional).",
        "placeholder": "Warm female alto, slight rasp."
      },
      "style": {
        "type": "string",
        "title": "Style Tags",
        "name": "style",
        "description": "Comma-separated style hints used at music generation time (optional).",
        "placeholder": "Pop, Female Vocal"
      },
      "language": {
        "enum": [
          "en",
          "zh",
          "es",
          "fr",
          "pt",
          "de",
          "ja",
          "ko",
          "hi",
          "ru"
        ],
        "title": "Language",
        "name": "language",
        "type": "string",
        "description": "Language the voice sample is spoken in.",
        "default": "en"
      },
      "vocal_start_s": {
        "type": "int",
        "title": "Vocal Start (seconds)",
        "name": "vocal_start_s",
        "description": "Start time of the vocal segment within the sample.",
        "default": 0,
        "minValue": 0,
        "maxValue": 60,
        "step": 1
      },
      "vocal_end_s": {
        "type": "int",
        "title": "Vocal End (seconds)",
        "name": "vocal_end_s",
        "description": "End time of the vocal segment within the sample. Must be greater than Vocal Start.",
        "default": 10,
        "minValue": 1,
        "maxValue": 60,
        "step": 1
      }
    }
  },
  {
    "id": "minimax-voice-clone",
    "name": "Minimax Voice Clone",
    "endpoint": "minimax-voice-clone",
    "family": "minimax-2.3",
    "description": "Minimax Voice Clone creates a high-fidelity digital clone of a speakerΓÇÖs voice from a short reference audio sample. It reproduces the speakerΓÇÖs tone, emotion, accent, rhythm, and speaking style, then generates new speech from any text input.",
    "required": [
      "audio_url",
      "custom_voice_id"
    ],
    "inputs": {
      "audio_url": {
        "examples": [
          "https://d3adwkbyhxyrtq.cloudfront.net/webassets/videomodels/minimax-voice-clone-in.wav"
        ],
        "description": "Url of the audio url.",
        "field": "audio",
        "type": "string",
        "title": "Audio URL",
        "name": "audio_url"
      },
      "custom_voice_id": {
        "examples": [
          ""
        ],
        "description": "Custom user-defined ID. Minimum 8 characters must include letters and numbers and start with a letter. Duplicate voice-ids will throw an error.",
        "format": "text",
        "type": "string",
        "title": "Custom Voice ID",
        "name": "custom_voice_id",
        "placeholder": "sf02174c-5f5d-46e6-8758-7544128c27b2"
      },
      "model": {
        "enum": [
          "speech-02-hd",
          "speech-02-turbo",
          "speech-2.5-hd-preview",
          "speech-2.5-turbo-preview",
          "speech-2.6-hd",
          "speech-2.6-turbo"
        ],
        "title": "Model",
        "name": "model",
        "type": "string",
        "description": "Specify the TTS model to be used for the preview. This is only a preview after cloning. Once the model is generated, any Minimax Turbo or HD voice model can be used for inference.",
        "default": "speech-02-hd"
      },
      "need_noise_reduction": {
        "type": "boolean",
        "title": "Need Noise Reduction",
        "name": "need_noise_reduction",
        "description": "Enable noise reduction. Default is false (no noise reduction).",
        "default": false
      },
      "need_volume_normalization": {
        "type": "boolean",
        "title": "Need Volume Normalization",
        "name": "need_volume_normalization",
        "description": "Specify whether to enable volume normalization.",
        "default": false
      },
      "accuracy": {
        "title": "Accuracy",
        "name": "accuracy",
        "type": "int",
        "description": "Text validation accuracy threshold, with a value range of [0, 1].",
        "default": 0.7,
        "minValue": 0,
        "maxValue": 1,
        "step": 0.01
      },
      "prompt": {
        "examples": [
          "Hello! Welcome to Muapiapp! This is a preview of your cloned voice. I hope you enjoy it!"
        ],
        "description": "Text for audio preview. Limited to 2000 characters.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      }
    }
  },
  {
    "id": "minimax-speech-2.6-hd",
    "name": "Minimax Speech HD",
    "endpoint": "minimax-speech-2.6-hd",
    "family": "minimax-2.6",
    "description": "Speech-2.6-hd is MinimaxΓÇÖs high-definition text-to-speech model that turns written text into natural, human-like audio. It produces studio-quality speech with clear pronunciation, smooth pacing, realistic emotion, and no background noise.",
    "required": [
      "prompt",
      "voice_id"
    ],
    "inputs": {
      "prompt": {
        "examples": [
          "Every journey begins with a single moment of courage. Today, that moment is yours."
        ],
        "description": "Text to convert to speech. Every character is 1 token. Maximum 10000 characters. Use <#x#> between words to control pause duration (0.01-99.99s).",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "voice_id": {
        "enum": [
          "Wise_Woman",
          "Friendly_Person",
          "Inspirational_girl",
          "Deep_Voice_Man",
          "Calm_Woman",
          "Casual_Guy",
          "Lively_Girl",
          "Patient_Man",
          "Young_Knight",
          "Determined_Man",
          "Lovely_Girl",
          "Decent_Boy",
          "Imposing_Manner",
          "Elegant_Man",
          "Abbess",
          "Sweet_Girl_2",
          "Exuberant_Girl",
          "English_expressive_narrator",
          "English_radiant_girl",
          "English_magnetic_voiced_man",
          "English_compelling_lady1",
          "English_Aussie_Bloke",
          "English_captivating_female1",
          "English_Upbeat_Woman",
          "English_Trustworth_Man",
          "English_CalmWoman",
          "English_UpsetGirl",
          "English_Gentle-voiced_man",
          "English_Whispering_girl_v3",
          "English_Diligent_Man",
          "English_Graceful_Lady",
          "English_Husky_MetalHead",
          "English_ReservedYoungMan",
          "Thai_female_1_sample1",
          "Thai_female_2_sample2",
          "English_PlayfulGirl",
          "English_ManWithDeepVoice",
          "English_GentleTeacher",
          "English_MaturePartner",
          "English_FriendlyPerson",
          "English_MatureBoss",
          "English_Debator",
          "whisper_man",
          "English_Abbess",
          "English_LovelyGirl",
          "whisper_woman_1",
          "English_Steadymentor",
          "English_Deep-VoicedGentleman",
          "English_DeterminedMan",
          "English_Wiselady",
          "English_CaptivatingStoryteller",
          "English_AttractiveGirl",
          "English_DecentYoungMan",
          "English_SentimentalLady",
          "English_ImposingManner",
          "English_SadTeen",
          "English_ThoughtfulMan",
          "English_PassionateWarrior",
          "English_DecentBoy",
          "English_WiseScholar",
          "English_Soft-spokenGirl",
          "English_SereneWoman",
          "English_ConfidentWoman",
          "English_PatientMan",
          "English_Comedian",
          "English_GorgeousLady",
          "English_BossyLeader",
          "English_LovelyLady",
          "English_Strong-WilledBoy",
          "English_Deep-tonedMan",
          "English_StressedLady",
          "English_AssertiveQueen",
          "English_AnimeCharacter",
          "Portuguese_Optimisticyouth",
          "Portuguese_CuteElf",
          "English_Jovialman",
          "English_WhimsicalGirl",
          "English_CharmingQueen",
          "English_Kind-heartedGirl",
          "English_FriendlyNeighbor",
          "English_Sweet_Female_4",
          "English_Magnetic_Male_2",
          "English_Lively_Male_11",
          "English_Friendly_Female_3",
          "English_Steady_Female_1",
          "English_Lively_Male_10",
          "English_Magnetic_Male_12",
          "English_Steady_Female_5",
          "English_Insightful_Speaker",
          "English_patient_man_v1",
          "English_Persuasive_Man",
          "English_Explanatory_Man",
          "English_intellect_female_1",
          "English_Cute_Girl",
          "English_Sharp_Commentator",
          "English_Honest_Man",
          "angry_pirate_1",
          "massive_kind_troll",
          "movie_trailer_deep",
          "peace_and_ease",
          "moss_audio_6dc281eb-713c-11f0-a447-9613c873494c",
          "moss_audio_c12a59b9-7115-11f0-a447-9613c873494c",
          "moss_audio_076697ad-7144-11f0-a447-9613c873494c",
          "moss_audio_737a299c-734a-11f0-918f-4e0486034804",
          "moss_audio_19dbb103-7350-11f0-ad20-f2bc95e89150",
          "moss_audio_7c7e7ae2-7356-11f0-9540-7ef9b4b62566",
          "moss_audio_570551b1-735c-11f0-b236-0adeeecad052",
          "conversational_female_1_v1",
          "conversational_female_2_v1",
          "socialmedia_female_1_v1",
          "BritishChild_male_1_v1",
          "BritishChild_female_1_v1",
          "Chinese (Mandarin)_Reliable_Executive",
          "Chinese (Mandarin)_News_Anchor",
          "Chinese (Mandarin)_Unrestrained_Young_Man",
          "Chinese (Mandarin)_Mature_Woman",
          "Arrogant_Miss",
          "Chinese (Mandarin)_Kind-hearted_Antie",
          "Robot_Armor",
          "hunyin_6",
          "Chinese (Mandarin)_HK_Flight_Attendant",
          "Chinese (Mandarin)_Humorous_Elder",
          "Chinese (Mandarin)_Gentleman",
          "Chinese (Mandarin)_Warm_Bestie",
          "Chinese (Mandarin)_Southern_Young_Man",
          "Chinese (Mandarin)_Wise_Women",
          "moss_audio_cedfd4d2-736d-11f0-99be-fe40dd2a5fe8",
          "moss_audio_a0d611da-737c-11f0-ad20-f2bc95e89150",
          "moss_audio_4f4172f4-737b-11f0-9540-7ef9b4b62566",
          "moss_audio_62ca20b0-7380-11f0-99be-fe40dd2a5fe8",
          "Portuguese_PowerfulSoldier",
          "Portuguese_FascinatingBoy",
          "Portuguese_RomanticHusband",
          "Portuguese_StrictBoss",
          "Chinese (Mandarin)_Stubborn_Friend",
          "Chinese (Mandarin)_Sweet_Lady",
          "moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8",
          "Chinese (Mandarin)_Gentle_Youth",
          "Chinese (Mandarin)_Warm_Girl",
          "Chinese (Mandarin)_Male_Announcer",
          "Chinese (Mandarin)_Kind-hearted_Elder",
          "Chinese (Mandarin)_Cute_Spirit",
          "Chinese (Mandarin)_Radio_Host",
          "Chinese (Mandarin)_Lyrical_Voice",
          "Chinese (Mandarin)_Straightforward_Boy",
          "Chinese (Mandarin)_Sincere_Adult",
          "Chinese (Mandarin)_Gentle_Senior",
          "Chinese (Mandarin)_Crisp_Girl",
          "Chinese (Mandarin)_Pure-hearted_Boy",
          "Chinese (Mandarin)_Soft_Girl",
          "Chinese (Mandarin)_IntellectualGirl",
          "Chinese (Mandarin)_Laid_BackGirl",
          "Chinese (Mandarin)_ExplorativeGirl",
          "Chinese (Mandarin)_Warm-HeartedAunt",
          "Chinese (Mandarin)_BashfulGirl",
          "Arabic_CalmWoman",
          "Arabic_FriendlyGuy",
          "Cantonese_ProfessionalHost∩╝êF)",
          "Cantonese_GentleLady",
          "Cantonese_ProfessionalHost∩╝êM)",
          "Cantonese_PlayfulMan",
          "Cantonese_CuteGirl",
          "Cantonese_KindWoman",
          "Cantonese_Narrator",
          "Cantonese_WiselProfessor",
          "Cantonese_IndifferentStaff",
          "Japanese_ColdQueen",
          "Japanese_DependableWoman",
          "Japanese_GentleButler",
          "Japanese_KindLady",
          "Dutch_kindhearted_girl",
          "Dutch_bossy_leader",
          "French_Male_Speech_New",
          "French_Female_News Anchor",
          "French_CasualMan",
          "French_MovieLeadFemale",
          "French_FemaleAnchor",
          "French_MaleNarrator",
          "French_Female Journalist",
          "French_Female_Speech_New",
          "German_FriendlyMan",
          "German_SweetLady",
          "German_PlayfulMan",
          "Indonesian_SweetGirl",
          "Indonesian_ReservedYoungMan",
          "Indonesian_CharmingGirl",
          "Russian_AmbitiousWoman",
          "Russian_ReliableMan",
          "Russian_CrazyQueen",
          "Russian_PessimisticGirl",
          "Indonesian_CalmWoman",
          "Indonesian_ConfidentWoman",
          "Indonesian_CaringMan",
          "Indonesian_BossyLeader",
          "Indonesian_DeterminedBoy",
          "Indonesian_GentleGirl",
          "Italian_BraveHeroine",
          "Italian_Narrator",
          "Italian_WanderingSorcerer",
          "Italian_DiligentLeader",
          "Italian_ReliableMan",
          "Italian_AthleticStudent",
          "Italian_ArrogantPrincess",
          "Japanese_Whisper_Belle",
          "Japanese_IntellectualSenior",
          "Japanese_DecisivePrincess",
          "Japanese_LoyalKnight",
          "Japanese_DominantMan",
          "Japanese_SeriousCommander",
          "Japanese_CalmLady",
          "Japanese_OptimisticYouth",
          "Japanese_GenerousIzakayaOwner",
          "Japanese_SportyStudent",
          "Japanese_InnocentBoy",
          "Japanese_GracefulMaiden",
          "Korean_PowerfulGirl",
          "Korean_BossyMan",
          "Korean_SweetGirl",
          "Korean_CheerfulBoyfriend",
          "Korean_EnchantingSister",
          "Korean_ShyGirl",
          "Korean_ReliableSister",
          "Korean_StrictBoss",
          "Korean_SassyGirl",
          "Korean_ChildhoodFriendGirl",
          "Korean_PlayboyCharmer",
          "Korean_ElegantPrincess",
          "English_energetic_male_1",
          "English_witty_female_1",
          "English_Lucky_Robot",
          "Korean_BraveFemaleWarrior",
          "Korean_BraveYouth",
          "Korean_CalmLady",
          "Korean_EnthusiasticTeen",
          "Korean_SoothingLady",
          "Korean_IntellectualSenior",
          "Korean_LonelyWarrior",
          "Korean_MatureLady",
          "Korean_InnocentBoy",
          "Korean_CharmingSister",
          "Korean_AthleticStudent",
          "Korean_BraveAdventurer",
          "Korean_CalmGentleman",
          "Korean_WiseElf",
          "Korean_CheerfulCoolJunior",
          "Korean_DecisiveQueen",
          "Korean_ColdYoungMan",
          "Korean_MysteriousGirl",
          "Korean_QuirkyGirl",
          "Korean_ConsiderateSenior",
          "Chinese (Mandarin)_Warm_HeartedGirl",
          "Korean_CheerfulLittleSister",
          "Korean_DominantMan",
          "Korean_AirheadedGirl",
          "Korean_ReliableYouth",
          "Korean_FriendlyBigSister",
          "Korean_GentleBoss",
          "Korean_ColdGirl",
          "Korean_HaughtyLady",
          "Korean_CharmingElderSister",
          "Korean_IntellectualMan",
          "Korean_CaringWoman",
          "Korean_WiseTeacher",
          "Korean_ConfidentBoss",
          "Korean_AthleticGirl",
          "Korean_PossessiveMan",
          "Korean_GentleWoman",
          "Korean_CockyGuy",
          "Korean_ThoughtfulWoman",
          "Korean_OptimisticYouth",
          "Portuguese_AnxiousMan",
          "Portuguese_Matureresearcher",
          "Portuguese_EnergeticGirl",
          "Portuguese_FunnyGuy",
          "Portuguese_Nuttylady",
          "Portuguese_Deep-tonedMan",
          "Portuguese_SentimentalLady",
          "Portuguese_BossyLeader",
          "Portuguese_Wiselady",
          "Portuguese_Strong-WilledBoy",
          "Portuguese_Deep-VoicedGentleman",
          "Portuguese_UpsetGirl",
          "Portuguese_PassionateWarrior",
          "Portuguese_AnimeCharacter",
          "Portuguese_ConfidentWoman",
          "Portuguese_AngryMan",
          "Portuguese_CaptivatingStoryteller",
          "Portuguese_Godfather",
          "Portuguese_ReservedYoungMan",
          "Portuguese_SmartYoungGirl",
          "Portuguese_Kind-heartedGirl",
          "Portuguese_Pompouslady",
          "Portuguese_Grinch",
          "Portuguese_Debator",
          "Portuguese_SweetGirl",
          "Portuguese_AttractiveGirl",
          "Portuguese_ThoughtfulMan",
          "Portuguese_PlayfulGirl",
          "Portuguese_GorgeousLady",
          "Portuguese_LovelyLady",
          "Portuguese_SereneWoman",
          "Portuguese_SadTeen",
          "Portuguese_MaturePartner",
          "Portuguese_Comedian",
          "Portuguese_NaughtySchoolgirl",
          "Portuguese_Narrator",
          "Portuguese_ToughBoss",
          "Portuguese_Fussyhostess",
          "Portuguese_Dramatist",
          "Portuguese_Steadymentor",
          "Portuguese_Jovialman",
          "Portuguese_CharmingQueen",
          "Portuguese_SantaClaus",
          "Portuguese_Rudolph",
          "Portuguese_Arnold",
          "Portuguese_CharmingSanta",
          "Portuguese_Ghost",
          "Portuguese_HumorousElder",
          "Portuguese_CalmLeader",
          "Portuguese_GentleTeacher",
          "Portuguese_EnergeticBoy",
          "Portuguese_ReliableMan",
          "Portuguese_SereneElder",
          "Portuguese_GrimReaper",
          "Portuguese_AssertiveQueen",
          "Portuguese_WhimsicalGirl",
          "Portuguese_StressedLady",
          "Portuguese_FriendlyNeighbor",
          "Portuguese_CaringGirlfriend",
          "Portuguese_InspiringLady",
          "Portuguese_PlayfulSpirit",
          "Portuguese_ElegantGirl",
          "Portuguese_CompellingGirl",
          "Portuguese_PowerfulVeteran",
          "Portuguese_SensibleManager",
          "Portuguese_ThoughtfulLady",
          "Portuguese_TheatricalActor",
          "Portuguese_FragileBoy",
          "Portuguese_ChattyGirl",
          "Portuguese_Conscientiousinstructor",
          "Portuguese_RationalMan",
          "Portuguese_WiseScholar",
          "Portuguese_FrankLady",
          "Portuguese_DeterminedManager",
          "Portuguese_CharmingLady",
          "Russian_HandsomeChildhoodFriend",
          "Russian_BrightHeroine",
          "Russian_AttractiveGuy",
          "Russian_Bad-temperedBoy",
          "Spanish_FriendlyNeighbor",
          "Spanish_FragileBoy",
          "Spanish_UpsetGirl",
          "Spanish_Soft-spokenGirl",
          "Spanish_CharmingQueen",
          "Spanish_Nuttylady",
          "Spanish_ElegantGirl",
          "Spanish_FascinatingBoy",
          "Spanish_FunnyGuy",
          "Spanish_PlayfulSpirit",
          "Spanish_TheatricalActor",
          "Spanish_SereneWoman",
          "Spanish_MaturePartner",
          "Spanish_CaptivatingStoryteller",
          "Spanish_Narrator",
          "Spanish_WiseScholar",
          "Spanish_Kind-heartedGirl",
          "Spanish_DeterminedManager",
          "Spanish_BossyLeader",
          "Spanish_ReservedYoungMan",
          "Spanish_ConfidentWoman",
          "Spanish_ThoughtfulMan",
          "Spanish_Strong-WilledBoy",
          "Spanish_SophisticatedLady",
          "Spanish_RationalMan",
          "Spanish_AnimeCharacter",
          "Spanish_Deep-tonedMan",
          "Spanish_Fussyhostess",
          "Spanish_SincereTeen",
          "Spanish_FrankLady",
          "Spanish_Comedian",
          "Spanish_Debator",
          "Spanish_ToughBoss",
          "Spanish_Wiselady",
          "Spanish_Steadymentor",
          "finnish_male_1_v2",
          "hindi_male_1_v2",
          "hindi_female_2_v1",
          "hindi_female_1_v2",
          "Spanish_Jovialman",
          "Spanish_SantaClaus",
          "Spanish_Rudolph",
          "Spanish_Intonategirl",
          "Spanish_Arnold",
          "Spanish_Ghost",
          "Spanish_HumorousElder",
          "Spanish_EnergeticBoy",
          "Spanish_WhimsicalGirl",
          "Spanish_StrictBoss",
          "Spanish_ReliableMan",
          "Spanish_SereneElder",
          "Spanish_AngryMan",
          "Spanish_AssertiveQueen",
          "Spanish_CaringGirlfriend",
          "Spanish_PowerfulSoldier",
          "Spanish_PassionateWarrior",
          "Spanish_ChattyGirl",
          "Spanish_RomanticHusband",
          "Spanish_CompellingGirl",
          "Spanish_PowerfulVeteran",
          "Spanish_SensibleManager",
          "Spanish_ThoughtfulLady",
          "Turkish_CalmWoman",
          "Turkish_Trustworthyman",
          "Ukrainian_CalmWoman",
          "Ukrainian_WiseScholar",
          "Vietnamese_Serene_Man",
          "Vietnamese_female_4_v1",
          "Vietnamese_male_1_v2",
          "Vietnamese_kindhearted_girl",
          "Thai_Optimistic_girl",
          "Thai_male_1_sample8",
          "Thai_Tender_Woman",
          "Thai_male_2_sample2",
          "Polish_male_1_sample4",
          "Polish_male_2_sample3",
          "Polish_female_1_sample1",
          "Polish_female_2_sample3",
          "Romanian_male_1_sample2",
          "Romanian_male_2_sample1",
          "Romanian_female_1_sample4",
          "Romanian_female_2_sample1",
          "Greek_female_1_sample1",
          "greek_male_1a_v1",
          "Greek_female_2_sample3",
          "czech_male_1_v1",
          "czech_female_5_v7",
          "czech_female_2_v2",
          "finnish_male_3_v1",
          "finnish_female_4_v1",
          "Bulgarian_male_2_v1",
          "Bulgarian_female_1_v1",
          "Danish_male_1_v1",
          "Danish_female_1_v1",
          "Hebrew_male_1_v1",
          "Hebrew_female_1_v1",
          "Malay_male_1_v1",
          "Malay_female_1_v1",
          "Malay_female_2_v1",
          "Persian_male_1_v1",
          "Persian_female_1_v1",
          "Slovak_male_1_v1",
          "Slovak_female_1_v1",
          "Swedish_male_1_v1",
          "Swedish_female_1_v1",
          "Croatian_male_1_v1",
          "Croatian_female_1_v1",
          "Filipino_male_1_v1",
          "Filipino_female_1_v1",
          "Hungarian_male_1_v1",
          "Hungarian_female_1_v1",
          "Norwegian_male_1_v1",
          "Norwegian_female_1_v1",
          "Slovenian_male_1_v1",
          "Slovenian_female_1_v2",
          "Catalan_male_1_v1",
          "Catalan_female_1_v1",
          "Nynorsk_male_1_v1",
          "Nynorsk_female_1_v1",
          "Tamil_male_1_v1",
          "Tamil_female_1_v1",
          "Afrikaans_male_1_v1",
          "Afrikaans_female_1_v1"
        ],
        "description": "Desired voice ID. Use a voice ID you have trained (https://muapi.ai/playground/minimax-voice-clone), or one of the following system voice IDs",
        "type": "string",
        "typing": true,
        "title": "Voice ID",
        "name": "voice_id",
        "default": "Friendly_Person"
      },
      "speed": {
        "title": "Speed",
        "name": "speed",
        "type": "int",
        "description": "Speech speed. Range: 0.5-2.0, where 1.0 is normal speed.",
        "default": 1,
        "minValue": 0.5,
        "maxValue": 2,
        "step": 0.01
      },
      "volume": {
        "title": "Volume",
        "name": "volume",
        "type": "int",
        "description": "Speech volume. Range: 0.1-10.0, where 1.0 is normal volume.",
        "default": 1,
        "minValue": 0.1,
        "maxValue": 10,
        "step": 0.01
      },
      "pitch": {
        "title": "Pitch",
        "name": "pitch",
        "type": "int",
        "description": "Speech pitch. Range: -12 to 12, where 0 is normal pitch.",
        "default": 0,
        "minValue": -12,
        "maxValue": 12,
        "step": 1
      },
      "emotion": {
        "enum": [
          "happy",
          "sad",
          "angry",
          "fearful",
          "disgusted",
          "surprised",
          "neutral"
        ],
        "title": "Emotion",
        "name": "emotion",
        "type": "string",
        "description": "The emotion of the generated speech.",
        "default": "happy"
      },
      "english_normalization": {
        "type": "boolean",
        "title": "English Normalization",
        "name": "english_normalization",
        "description": "This parameter supports English text normalization, which improves performance in number-reading scenarios.",
        "default": false
      },
      "sample_rate": {
        "enum": [
          8000,
          16000,
          22050,
          24000,
          32000,
          44100
        ],
        "type": "integer",
        "title": "Sample Rate",
        "name": "sample_rate",
        "description": "Sample rate of generated sound.",
        "default": 8000
      },
      "bitrate": {
        "enum": [
          32000,
          64000,
          128000,
          256000
        ],
        "type": "integer",
        "title": "Bitrate",
        "name": "bitrate",
        "description": "Bitrate of generated sound.",
        "default": 32000
      },
      "channel": {
        "enum": [
          1,
          2
        ],
        "type": "integer",
        "title": "Channel",
        "name": "channel",
        "description": "he number of channels of the generated audio. 1: mono, 2: stereo.",
        "default": 1
      },
      "format": {
        "enum": [
          "mp3",
          "wav",
          "pcm",
          "flac"
        ],
        "type": "string",
        "title": "Format",
        "name": "format",
        "description": "Format of generated sound.",
        "default": "mp3"
      },
      "language_boost": {
        "enum": [
          "Chinese",
          "Chinese,Yue",
          "English",
          "Arabic",
          "Russian",
          "Spanish",
          "French",
          "Portuguese",
          "German",
          "Turkish",
          "Dutch",
          "Ukrainian",
          "Vietnamese",
          "Indonesian",
          "Japanese",
          "Italian",
          "Korean",
          "Thai",
          "Polish",
          "Romanian",
          "Greek",
          "Czech",
          "Finnish",
          "Hindi",
          "Bulgarian",
          "Danish",
          "Hebrew",
          "Malay",
          "Persian",
          "Slovak",
          "Swedish",
          "Croatian",
          "Filipino",
          "Hungarian",
          "Norwegian",
          "Slovenian",
          "Catalan",
          "Nynorsk",
          "Tamil",
          "Afrikaans",
          "auto"
        ],
        "title": "Language Boost",
        "name": "language_boost",
        "type": "string",
        "description": "Enhance the ability to recognize specified languages and dialects.",
        "default": "auto"
      }
    }
  },
  {
    "id": "minimax-speech-2.6-turbo",
    "name": "Minimax Speech Turbo",
    "endpoint": "minimax-speech-2.6-turbo",
    "family": "minimax-2.6",
    "description": "Speech-2.6-turbo is MinimaxΓÇÖs fast, lightweight text-to-speech model designed for quick audio generation while maintaining good natural voice quality. It produces clear speech with smooth pacing and minimal delay.",
    "required": [
      "prompt",
      "voice_id"
    ],
    "inputs": {
      "prompt": {
        "examples": [
          "Welcome to Minimax-Speech 2.6 by Muapiapp! Get ready for an audio revolution! We are thrilled to introduce a model so realistic, it's virtually indistinguishable from a human voice. You're going to be amazed by its lifelike delivery!"
        ],
        "description": "Text to convert to speech. Every character is 1 token. Maximum 10000 characters. Use <#x#> between words to control pause duration (0.01-99.99s).",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "voice_id": {
        "enum": [
          "Wise_Woman",
          "Friendly_Person",
          "Inspirational_girl",
          "Deep_Voice_Man",
          "Calm_Woman",
          "Casual_Guy",
          "Lively_Girl",
          "Patient_Man",
          "Young_Knight",
          "Determined_Man",
          "Lovely_Girl",
          "Decent_Boy",
          "Imposing_Manner",
          "Elegant_Man",
          "Abbess",
          "Sweet_Girl_2",
          "Exuberant_Girl",
          "English_expressive_narrator",
          "English_radiant_girl",
          "English_magnetic_voiced_man",
          "English_compelling_lady1",
          "English_Aussie_Bloke",
          "English_captivating_female1",
          "English_Upbeat_Woman",
          "English_Trustworth_Man",
          "English_CalmWoman",
          "English_UpsetGirl",
          "English_Gentle-voiced_man",
          "English_Whispering_girl_v3",
          "English_Diligent_Man",
          "English_Graceful_Lady",
          "English_Husky_MetalHead",
          "English_ReservedYoungMan",
          "Thai_female_1_sample1",
          "Thai_female_2_sample2",
          "English_PlayfulGirl",
          "English_ManWithDeepVoice",
          "English_GentleTeacher",
          "English_MaturePartner",
          "English_FriendlyPerson",
          "English_MatureBoss",
          "English_Debator",
          "whisper_man",
          "English_Abbess",
          "English_LovelyGirl",
          "whisper_woman_1",
          "English_Steadymentor",
          "English_Deep-VoicedGentleman",
          "English_DeterminedMan",
          "English_Wiselady",
          "English_CaptivatingStoryteller",
          "English_AttractiveGirl",
          "English_DecentYoungMan",
          "English_SentimentalLady",
          "English_ImposingManner",
          "English_SadTeen",
          "English_ThoughtfulMan",
          "English_PassionateWarrior",
          "English_DecentBoy",
          "English_WiseScholar",
          "English_Soft-spokenGirl",
          "English_SereneWoman",
          "English_ConfidentWoman",
          "English_PatientMan",
          "English_Comedian",
          "English_GorgeousLady",
          "English_BossyLeader",
          "English_LovelyLady",
          "English_Strong-WilledBoy",
          "English_Deep-tonedMan",
          "English_StressedLady",
          "English_AssertiveQueen",
          "English_AnimeCharacter",
          "Portuguese_Optimisticyouth",
          "Portuguese_CuteElf",
          "English_Jovialman",
          "English_WhimsicalGirl",
          "English_CharmingQueen",
          "English_Kind-heartedGirl",
          "English_FriendlyNeighbor",
          "English_Sweet_Female_4",
          "English_Magnetic_Male_2",
          "English_Lively_Male_11",
          "English_Friendly_Female_3",
          "English_Steady_Female_1",
          "English_Lively_Male_10",
          "English_Magnetic_Male_12",
          "English_Steady_Female_5",
          "English_Insightful_Speaker",
          "English_patient_man_v1",
          "English_Persuasive_Man",
          "English_Explanatory_Man",
          "English_intellect_female_1",
          "English_Cute_Girl",
          "English_Sharp_Commentator",
          "English_Honest_Man",
          "angry_pirate_1",
          "massive_kind_troll",
          "movie_trailer_deep",
          "peace_and_ease",
          "moss_audio_6dc281eb-713c-11f0-a447-9613c873494c",
          "moss_audio_c12a59b9-7115-11f0-a447-9613c873494c",
          "moss_audio_076697ad-7144-11f0-a447-9613c873494c",
          "moss_audio_737a299c-734a-11f0-918f-4e0486034804",
          "moss_audio_19dbb103-7350-11f0-ad20-f2bc95e89150",
          "moss_audio_7c7e7ae2-7356-11f0-9540-7ef9b4b62566",
          "moss_audio_570551b1-735c-11f0-b236-0adeeecad052",
          "conversational_female_1_v1",
          "conversational_female_2_v1",
          "socialmedia_female_1_v1",
          "BritishChild_male_1_v1",
          "BritishChild_female_1_v1",
          "Chinese (Mandarin)_Reliable_Executive",
          "Chinese (Mandarin)_News_Anchor",
          "Chinese (Mandarin)_Unrestrained_Young_Man",
          "Chinese (Mandarin)_Mature_Woman",
          "Arrogant_Miss",
          "Chinese (Mandarin)_Kind-hearted_Antie",
          "Robot_Armor",
          "hunyin_6",
          "Chinese (Mandarin)_HK_Flight_Attendant",
          "Chinese (Mandarin)_Humorous_Elder",
          "Chinese (Mandarin)_Gentleman",
          "Chinese (Mandarin)_Warm_Bestie",
          "Chinese (Mandarin)_Southern_Young_Man",
          "Chinese (Mandarin)_Wise_Women",
          "moss_audio_cedfd4d2-736d-11f0-99be-fe40dd2a5fe8",
          "moss_audio_a0d611da-737c-11f0-ad20-f2bc95e89150",
          "moss_audio_4f4172f4-737b-11f0-9540-7ef9b4b62566",
          "moss_audio_62ca20b0-7380-11f0-99be-fe40dd2a5fe8",
          "Portuguese_PowerfulSoldier",
          "Portuguese_FascinatingBoy",
          "Portuguese_RomanticHusband",
          "Portuguese_StrictBoss",
          "Chinese (Mandarin)_Stubborn_Friend",
          "Chinese (Mandarin)_Sweet_Lady",
          "moss_audio_ad5baf92-735f-11f0-8263-fe5a2fe98ec8",
          "Chinese (Mandarin)_Gentle_Youth",
          "Chinese (Mandarin)_Warm_Girl",
          "Chinese (Mandarin)_Male_Announcer",
          "Chinese (Mandarin)_Kind-hearted_Elder",
          "Chinese (Mandarin)_Cute_Spirit",
          "Chinese (Mandarin)_Radio_Host",
          "Chinese (Mandarin)_Lyrical_Voice",
          "Chinese (Mandarin)_Straightforward_Boy",
          "Chinese (Mandarin)_Sincere_Adult",
          "Chinese (Mandarin)_Gentle_Senior",
          "Chinese (Mandarin)_Crisp_Girl",
          "Chinese (Mandarin)_Pure-hearted_Boy",
          "Chinese (Mandarin)_Soft_Girl",
          "Chinese (Mandarin)_IntellectualGirl",
          "Chinese (Mandarin)_Laid_BackGirl",
          "Chinese (Mandarin)_ExplorativeGirl",
          "Chinese (Mandarin)_Warm-HeartedAunt",
          "Chinese (Mandarin)_BashfulGirl",
          "Arabic_CalmWoman",
          "Arabic_FriendlyGuy",
          "Cantonese_ProfessionalHost∩╝êF)",
          "Cantonese_GentleLady",
          "Cantonese_ProfessionalHost∩╝êM)",
          "Cantonese_PlayfulMan",
          "Cantonese_CuteGirl",
          "Cantonese_KindWoman",
          "Cantonese_Narrator",
          "Cantonese_WiselProfessor",
          "Cantonese_IndifferentStaff",
          "Japanese_ColdQueen",
          "Japanese_DependableWoman",
          "Japanese_GentleButler",
          "Japanese_KindLady",
          "Dutch_kindhearted_girl",
          "Dutch_bossy_leader",
          "French_Male_Speech_New",
          "French_Female_News Anchor",
          "French_CasualMan",
          "French_MovieLeadFemale",
          "French_FemaleAnchor",
          "French_MaleNarrator",
          "French_Female Journalist",
          "French_Female_Speech_New",
          "German_FriendlyMan",
          "German_SweetLady",
          "German_PlayfulMan",
          "Indonesian_SweetGirl",
          "Indonesian_ReservedYoungMan",
          "Indonesian_CharmingGirl",
          "Russian_AmbitiousWoman",
          "Russian_ReliableMan",
          "Russian_CrazyQueen",
          "Russian_PessimisticGirl",
          "Indonesian_CalmWoman",
          "Indonesian_ConfidentWoman",
          "Indonesian_CaringMan",
          "Indonesian_BossyLeader",
          "Indonesian_DeterminedBoy",
          "Indonesian_GentleGirl",
          "Italian_BraveHeroine",
          "Italian_Narrator",
          "Italian_WanderingSorcerer",
          "Italian_DiligentLeader",
          "Italian_ReliableMan",
          "Italian_AthleticStudent",
          "Italian_ArrogantPrincess",
          "Japanese_Whisper_Belle",
          "Japanese_IntellectualSenior",
          "Japanese_DecisivePrincess",
          "Japanese_LoyalKnight",
          "Japanese_DominantMan",
          "Japanese_SeriousCommander",
          "Japanese_CalmLady",
          "Japanese_OptimisticYouth",
          "Japanese_GenerousIzakayaOwner",
          "Japanese_SportyStudent",
          "Japanese_InnocentBoy",
          "Japanese_GracefulMaiden",
          "Korean_PowerfulGirl",
          "Korean_BossyMan",
          "Korean_SweetGirl",
          "Korean_CheerfulBoyfriend",
          "Korean_EnchantingSister",
          "Korean_ShyGirl",
          "Korean_ReliableSister",
          "Korean_StrictBoss",
          "Korean_SassyGirl",
          "Korean_ChildhoodFriendGirl",
          "Korean_PlayboyCharmer",
          "Korean_ElegantPrincess",
          "English_energetic_male_1",
          "English_witty_female_1",
          "English_Lucky_Robot",
          "Korean_BraveFemaleWarrior",
          "Korean_BraveYouth",
          "Korean_CalmLady",
          "Korean_EnthusiasticTeen",
          "Korean_SoothingLady",
          "Korean_IntellectualSenior",
          "Korean_LonelyWarrior",
          "Korean_MatureLady",
          "Korean_InnocentBoy",
          "Korean_CharmingSister",
          "Korean_AthleticStudent",
          "Korean_BraveAdventurer",
          "Korean_CalmGentleman",
          "Korean_WiseElf",
          "Korean_CheerfulCoolJunior",
          "Korean_DecisiveQueen",
          "Korean_ColdYoungMan",
          "Korean_MysteriousGirl",
          "Korean_QuirkyGirl",
          "Korean_ConsiderateSenior",
          "Chinese (Mandarin)_Warm_HeartedGirl",
          "Korean_CheerfulLittleSister",
          "Korean_DominantMan",
          "Korean_AirheadedGirl",
          "Korean_ReliableYouth",
          "Korean_FriendlyBigSister",
          "Korean_GentleBoss",
          "Korean_ColdGirl",
          "Korean_HaughtyLady",
          "Korean_CharmingElderSister",
          "Korean_IntellectualMan",
          "Korean_CaringWoman",
          "Korean_WiseTeacher",
          "Korean_ConfidentBoss",
          "Korean_AthleticGirl",
          "Korean_PossessiveMan",
          "Korean_GentleWoman",
          "Korean_CockyGuy",
          "Korean_ThoughtfulWoman",
          "Korean_OptimisticYouth",
          "Portuguese_AnxiousMan",
          "Portuguese_Matureresearcher",
          "Portuguese_EnergeticGirl",
          "Portuguese_FunnyGuy",
          "Portuguese_Nuttylady",
          "Portuguese_Deep-tonedMan",
          "Portuguese_SentimentalLady",
          "Portuguese_BossyLeader",
          "Portuguese_Wiselady",
          "Portuguese_Strong-WilledBoy",
          "Portuguese_Deep-VoicedGentleman",
          "Portuguese_UpsetGirl",
          "Portuguese_PassionateWarrior",
          "Portuguese_AnimeCharacter",
          "Portuguese_ConfidentWoman",
          "Portuguese_AngryMan",
          "Portuguese_CaptivatingStoryteller",
          "Portuguese_Godfather",
          "Portuguese_ReservedYoungMan",
          "Portuguese_SmartYoungGirl",
          "Portuguese_Kind-heartedGirl",
          "Portuguese_Pompouslady",
          "Portuguese_Grinch",
          "Portuguese_Debator",
          "Portuguese_SweetGirl",
          "Portuguese_AttractiveGirl",
          "Portuguese_ThoughtfulMan",
          "Portuguese_PlayfulGirl",
          "Portuguese_GorgeousLady",
          "Portuguese_LovelyLady",
          "Portuguese_SereneWoman",
          "Portuguese_SadTeen",
          "Portuguese_MaturePartner",
          "Portuguese_Comedian",
          "Portuguese_NaughtySchoolgirl",
          "Portuguese_Narrator",
          "Portuguese_ToughBoss",
          "Portuguese_Fussyhostess",
          "Portuguese_Dramatist",
          "Portuguese_Steadymentor",
          "Portuguese_Jovialman",
          "Portuguese_CharmingQueen",
          "Portuguese_SantaClaus",
          "Portuguese_Rudolph",
          "Portuguese_Arnold",
          "Portuguese_CharmingSanta",
          "Portuguese_Ghost",
          "Portuguese_HumorousElder",
          "Portuguese_CalmLeader",
          "Portuguese_GentleTeacher",
          "Portuguese_EnergeticBoy",
          "Portuguese_ReliableMan",
          "Portuguese_SereneElder",
          "Portuguese_GrimReaper",
          "Portuguese_AssertiveQueen",
          "Portuguese_WhimsicalGirl",
          "Portuguese_StressedLady",
          "Portuguese_FriendlyNeighbor",
          "Portuguese_CaringGirlfriend",
          "Portuguese_InspiringLady",
          "Portuguese_PlayfulSpirit",
          "Portuguese_ElegantGirl",
          "Portuguese_CompellingGirl",
          "Portuguese_PowerfulVeteran",
          "Portuguese_SensibleManager",
          "Portuguese_ThoughtfulLady",
          "Portuguese_TheatricalActor",
          "Portuguese_FragileBoy",
          "Portuguese_ChattyGirl",
          "Portuguese_Conscientiousinstructor",
          "Portuguese_RationalMan",
          "Portuguese_WiseScholar",
          "Portuguese_FrankLady",
          "Portuguese_DeterminedManager",
          "Portuguese_CharmingLady",
          "Russian_HandsomeChildhoodFriend",
          "Russian_BrightHeroine",
          "Russian_AttractiveGuy",
          "Russian_Bad-temperedBoy",
          "Spanish_FriendlyNeighbor",
          "Spanish_FragileBoy",
          "Spanish_UpsetGirl",
          "Spanish_Soft-spokenGirl",
          "Spanish_CharmingQueen",
          "Spanish_Nuttylady",
          "Spanish_ElegantGirl",
          "Spanish_FascinatingBoy",
          "Spanish_FunnyGuy",
          "Spanish_PlayfulSpirit",
          "Spanish_TheatricalActor",
          "Spanish_SereneWoman",
          "Spanish_MaturePartner",
          "Spanish_CaptivatingStoryteller",
          "Spanish_Narrator",
          "Spanish_WiseScholar",
          "Spanish_Kind-heartedGirl",
          "Spanish_DeterminedManager",
          "Spanish_BossyLeader",
          "Spanish_ReservedYoungMan",
          "Spanish_ConfidentWoman",
          "Spanish_ThoughtfulMan",
          "Spanish_Strong-WilledBoy",
          "Spanish_SophisticatedLady",
          "Spanish_RationalMan",
          "Spanish_AnimeCharacter",
          "Spanish_Deep-tonedMan",
          "Spanish_Fussyhostess",
          "Spanish_SincereTeen",
          "Spanish_FrankLady",
          "Spanish_Comedian",
          "Spanish_Debator",
          "Spanish_ToughBoss",
          "Spanish_Wiselady",
          "Spanish_Steadymentor",
          "finnish_male_1_v2",
          "hindi_male_1_v2",
          "hindi_female_2_v1",
          "hindi_female_1_v2",
          "Spanish_Jovialman",
          "Spanish_SantaClaus",
          "Spanish_Rudolph",
          "Spanish_Intonategirl",
          "Spanish_Arnold",
          "Spanish_Ghost",
          "Spanish_HumorousElder",
          "Spanish_EnergeticBoy",
          "Spanish_WhimsicalGirl",
          "Spanish_StrictBoss",
          "Spanish_ReliableMan",
          "Spanish_SereneElder",
          "Spanish_AngryMan",
          "Spanish_AssertiveQueen",
          "Spanish_CaringGirlfriend",
          "Spanish_PowerfulSoldier",
          "Spanish_PassionateWarrior",
          "Spanish_ChattyGirl",
          "Spanish_RomanticHusband",
          "Spanish_CompellingGirl",
          "Spanish_PowerfulVeteran",
          "Spanish_SensibleManager",
          "Spanish_ThoughtfulLady",
          "Turkish_CalmWoman",
          "Turkish_Trustworthyman",
          "Ukrainian_CalmWoman",
          "Ukrainian_WiseScholar",
          "Vietnamese_Serene_Man",
          "Vietnamese_female_4_v1",
          "Vietnamese_male_1_v2",
          "Vietnamese_kindhearted_girl",
          "Thai_Optimistic_girl",
          "Thai_male_1_sample8",
          "Thai_Tender_Woman",
          "Thai_male_2_sample2",
          "Polish_male_1_sample4",
          "Polish_male_2_sample3",
          "Polish_female_1_sample1",
          "Polish_female_2_sample3",
          "Romanian_male_1_sample2",
          "Romanian_male_2_sample1",
          "Romanian_female_1_sample4",
          "Romanian_female_2_sample1",
          "Greek_female_1_sample1",
          "greek_male_1a_v1",
          "Greek_female_2_sample3",
          "czech_male_1_v1",
          "czech_female_5_v7",
          "czech_female_2_v2",
          "finnish_male_3_v1",
          "finnish_female_4_v1",
          "Bulgarian_male_2_v1",
          "Bulgarian_female_1_v1",
          "Danish_male_1_v1",
          "Danish_female_1_v1",
          "Hebrew_male_1_v1",
          "Hebrew_female_1_v1",
          "Malay_male_1_v1",
          "Malay_female_1_v1",
          "Malay_female_2_v1",
          "Persian_male_1_v1",
          "Persian_female_1_v1",
          "Slovak_male_1_v1",
          "Slovak_female_1_v1",
          "Swedish_male_1_v1",
          "Swedish_female_1_v1",
          "Croatian_male_1_v1",
          "Croatian_female_1_v1",
          "Filipino_male_1_v1",
          "Filipino_female_1_v1",
          "Hungarian_male_1_v1",
          "Hungarian_female_1_v1",
          "Norwegian_male_1_v1",
          "Norwegian_female_1_v1",
          "Slovenian_male_1_v1",
          "Slovenian_female_1_v2",
          "Catalan_male_1_v1",
          "Catalan_female_1_v1",
          "Nynorsk_male_1_v1",
          "Nynorsk_female_1_v1",
          "Tamil_male_1_v1",
          "Tamil_female_1_v1",
          "Afrikaans_male_1_v1",
          "Afrikaans_female_1_v1"
        ],
        "description": "Desired voice ID. Use a voice ID you have trained (https://muapi.ai/playground/minimax-voice-clone), or one of the following system voice IDs",
        "type": "string",
        "typing": true,
        "title": "Voice ID",
        "name": "voice_id",
        "default": "Friendly_Person"
      },
      "speed": {
        "title": "Speed",
        "name": "speed",
        "type": "int",
        "description": "Speech speed. Range: 0.5-2.0, where 1.0 is normal speed.",
        "default": 1,
        "minValue": 0.5,
        "maxValue": 2,
        "step": 0.01
      },
      "volume": {
        "title": "Volume",
        "name": "volume",
        "type": "int",
        "description": "Speech volume. Range: 0.1-10.0, where 1.0 is normal volume.",
        "default": 1,
        "minValue": 0.1,
        "maxValue": 10,
        "step": 0.01
      },
      "pitch": {
        "title": "Pitch",
        "name": "pitch",
        "type": "int",
        "description": "Speech pitch. Range: -12 to 12, where 0 is normal pitch.",
        "default": 0,
        "minValue": -12,
        "maxValue": 12,
        "step": 1
      },
      "emotion": {
        "enum": [
          "happy",
          "sad",
          "angry",
          "fearful",
          "disgusted",
          "surprised",
          "neutral"
        ],
        "title": "Emotion",
        "name": "emotion",
        "type": "string",
        "description": "The emotion of the generated speech.",
        "default": "surprised"
      },
      "english_normalization": {
        "type": "boolean",
        "title": "English Normalization",
        "name": "english_normalization",
        "description": "This parameter supports English text normalization, which improves performance in number-reading scenarios.",
        "default": false
      },
      "sample_rate": {
        "enum": [
          8000,
          16000,
          22050,
          24000,
          32000,
          44100
        ],
        "type": "integer",
        "title": "Sample Rate",
        "name": "sample_rate",
        "description": "Sample rate of generated sound.",
        "default": 8000
      },
      "bitrate": {
        "enum": [
          32000,
          64000,
          128000,
          256000
        ],
        "type": "integer",
        "title": "Bitrate",
        "name": "bitrate",
        "description": "Bitrate of generated sound.",
        "default": 32000
      },
      "channel": {
        "enum": [
          1,
          2
        ],
        "type": "integer",
        "title": "Channel",
        "name": "channel",
        "description": "he number of channels of the generated audio. 1: mono, 2: stereo.",
        "default": 1
      },
      "format": {
        "enum": [
          "mp3",
          "wav",
          "pcm",
          "flac"
        ],
        "type": "string",
        "title": "Format",
        "name": "format",
        "description": "Format of generated sound.",
        "default": "mp3"
      },
      "language_boost": {
        "enum": [
          "Chinese",
          "Chinese,Yue",
          "English",
          "Arabic",
          "Russian",
          "Spanish",
          "French",
          "Portuguese",
          "German",
          "Turkish",
          "Dutch",
          "Ukrainian",
          "Vietnamese",
          "Indonesian",
          "Japanese",
          "Italian",
          "Korean",
          "Thai",
          "Polish",
          "Romanian",
          "Greek",
          "Czech",
          "Finnish",
          "Hindi",
          "Bulgarian",
          "Danish",
          "Hebrew",
          "Malay",
          "Persian",
          "Slovak",
          "Swedish",
          "Croatian",
          "Filipino",
          "Hungarian",
          "Norwegian",
          "Slovenian",
          "Catalan",
          "Nynorsk",
          "Tamil",
          "Afrikaans",
          "auto"
        ],
        "title": "Language Boost",
        "name": "language_boost",
        "type": "string",
        "description": "Enhance the ability to recognize specified languages and dialects.",
        "default": "auto"
      }
    }
  },{
    "id": "mmaudio-v2-text-to-audio",
    "name": "MM Audio V2",
    "endpoint": "mmaudio-v2/text-to-audio",
    "family": "mmaudio",
    "description": "Convert text into natural-sounding speech using mmAudio-v2. Ideal for voiceovers, virtual assistants, and content narration with lifelike clarity and tone.",
    "required": [
      "prompt"
    ],
    "inputs": {
      "prompt": {
        "examples": [
          "Indian holy music"
        ],
        "description": "The prompt to generate the audio for.",
        "type": "string",
        "title": "Prompt",
        "name": "prompt"
      },
      "duration": {
        "title": "Duration",
        "name": "duration",
        "type": "int",
        "description": "The duration of the audio to generate.",
        "default": 8,
        "minValue": 1,
        "maxValue": 30,
        "step": 1
      }
    }
  }
,
  {
    "id": "elevenlabs-text-to-dialogue-v3",
    "name": "ElevenLabs Text to Dialogue V3",
    "endpoint": "elevenlabs-text-to-dialogue-v3",
    "family": "audio-generation",
    "description": "Generate expressive, multilingual text-to-dialogue content using the ElevenLabs Text To Dialogue V3 model.",
    "required": [
      "dialogue"
    ],
    "inputs": {
      "dialogue": {
        "type": "array",
        "title": "Dialogue Script",
        "description": "List of speaker turns.",
        "items": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "title": "Text",
              "description": "Speech text for the character."
            },
            "voice_id": {
              "type": "string",
              "title": "Voice ID",
              "description": "ElevenLabs voice ID. Select a popular voice or paste your own custom voice ID.",
              "typing": true,
              "enum": [
                {
                  "label": "James - Husky, Engaging and Bold",
                  "value": "ZQe5CZNOzWyzPSCn5a3c"
                },
                {
                  "label": "Arabella - Mysterious and Emotive",
                  "value": "Z3R5wn05IrDiVCyEkUrK"
                },
                {
                  "label": "Bradford - Expressive and Articulate",
                  "value": "NNl6r8mD7vthiJatiJt1"
                },
                {
                  "label": "Xavier - Dominating, Metallic Announcer",
                  "value": "YOq2y2Up4RgXP2HyXjE5"
                },
                {
                  "label": "Taksh - Calm, Serious and Smooth",
                  "value": "qDuRKMlYmrm8trt5QyBn"
                },
                {
                  "label": "Monika Sogam - Deep and Natural",
                  "value": "iP95p4xoKVk53GoZ742B"
                },
                {
                  "label": "Mark - Casual, Relaxed and Light",
                  "value": "UgBBYS2sOqTuMpoF3BR0"
                },
                {
                  "label": "Adeline - Feminine and Conversational",
                  "value": "5l5f8iK3YPeGga21rQIX"
                },
                {
                  "label": "Sam - Support Agent",
                  "value": "yoZ06aMxZJJ28mfd3POQ"
                },
                {
                  "label": "Spuds Oxley - Wise and Approachable",
                  "value": "NOpBlnGInO9m6vDvFkFC"
                },
                {
                  "label": "Eve - Authentic, Energetic and Happy",
                  "value": "scOwDtmlLZohaFMFCHFe"
                },
                {
                  "label": "Callum - Husky Trickster",
                  "value": "N2lVS1w4EtoT3dr4eOWO"
                },
                {
                  "label": "Laura - Enthusiast, Quirky Attitude",
                  "value": "FGY2WhTYpPnrIDTdsKH5"
                },
                {
                  "label": "Brian - Deep, Resonant and Comforting",
                  "value": "zPhCVfO2NBER7bRLIdbq"
                },
                {
                  "label": "Nathan - Virtual Radio Host",
                  "value": "nPczCjzI2devNBz1zQrb"
                },
                {
                  "label": "Charlie - Natural",
                  "value": "IKne3meq5aSn9XLyUdCD"
                },
                {
                  "label": "George - Warm",
                  "value": "JBFqnCBsd6RMkjVDRZzb"
                },
                {
                  "label": "Sarah - Soft",
                  "value": "EXAVITQu4vr4xnSDxMaL"
                },
                {
                  "label": "Charlotte - Clear",
                  "value": "XB0fDUnXU5powFXDhCwa"
                },
                {
                  "label": "Hope - Bubbly, Gossipy and Girly",
                  "value": "tnSpp4vdxKPjI9w0GnoV"
                },
                {
                  "label": "Finn - Youthful, Eager and Energetic",
                  "value": "DYkrAHD8iwork3YSUBbs"
                },
                {
                  "label": "Tom - Conversations and Books",
                  "value": "56AoDkrOh6qfVPDXZ7Pt"
                },
                {
                  "label": "Lucy - Fresh and Casual",
                  "value": "lcMyyd2HUfFzxdCaC4Ta"
                },
                {
                  "label": "Tiffany - Natural and Welcoming",
                  "value": "6aDn1KB0hjpdcocrUkmq"
                },
                {
                  "label": "Brock - Commanding and Loud Sergeant",
                  "value": "7ftFdxRlmR6Z9V3nTdUh"
                },
                {
                  "label": "Viraj - Rich and Soft",
                  "value": "bajNon13EdhNMndG3z05"
                }
              ]
            }
          },
          "required": [
            "text",
            "voice_id"
          ]
        }
      },
      "stability": {
        "type": "number",
        "title": "Stability",
        "description": "Determines voice stability and randomness (0 to 1, default 0.5).",
        "default": 0.5
      },
      "language_code": {
        "type": "string",
        "title": "Language Code",
        "description": "Target language for dialogue. Leave empty for automatic language detection.",
        "default": null,
        "enum": [
          "af",
          "ar",
          "hy",
          "as",
          "az",
          "be",
          "bn",
          "bs",
          "bg",
          "ca",
          "ceb",
          "ny",
          "hr",
          "cs",
          "da",
          "nl",
          "en",
          "et",
          "fil",
          "fi",
          "fr",
          "gl",
          "ka",
          "de",
          "el",
          "gu",
          "ha",
          "he",
          "hi",
          "hu",
          "is",
          "id",
          "ga",
          "it",
          "ja",
          "jv",
          "kn",
          "kk",
          "ky",
          "ko",
          "lv",
          "ln",
          "lt",
          "lb",
          "mk",
          "ms",
          "ml",
          "zh",
          "mr",
          "ne",
          "no",
          "ps",
          "fa",
          "pl",
          "pt",
          "pa",
          "ro",
          "ru",
          "sr",
          "sd",
          "sk",
          "sl",
          "so",
          "es",
          "sw",
          "sv",
          "ta",
          "te",
          "th",
          "tr",
          "uk",
          "ur",
          "vi",
          "cy"
        ]
      }
    }
  },
  {
    "id": "suno-convert-to-wav",
    "name": "Suno Convert to WAV",
    "endpoint": "suno-convert-to-wav",
    "family": "suno",
    "description": "Converts an existing Suno-generated music track to high-quality, uncompressed WAV format for professional editing and processing.",
    "required": [
      "task_id",
      "audio_id"
    ],
    "inputs": {
      "task_id": {
        "examples": [
          "5c79b5b3-1234-4a12-9f10-abcdef8be8e"
        ],
        "description": "The request_id returned from a prior Generate Music / Remix Music / Extend Music request whose track you want to convert.",
        "type": "string",
        "title": "Task ID",
        "name": "task_id"
      },
      "audio_id": {
        "examples": [
          "e231e123-4567-89ab-cdef-0123456789ab"
        ],
        "description": "The id of the specific audio track to convert, taken from the `audio_ids` list returned in that task's output.",
        "type": "string",
        "title": "Audio ID",
        "name": "audio_id"
      }
    }
  },
  {
    "id": "gemini-3-1-flash-tts",
    "name": "Gemini 3.1 Flash TTS",
    "endpoint": "gemini-3-1-flash-tts",
    "family": "gemini-tts",
    "description": "Gemini 3.1 Flash TTS turns written dialogue into expressive, natural multi-speaker speech with fine-grained control over voice, accent, emotional style, and pace.",
    "required": [
      "speakers",
      "dialogue_turns"
    ],
    "inputs": {
      "speakers": {
        "type": "array",
        "title": "Speakers",
        "name": "speakers",
        "description": "List of speaker voice configurations. Each dialogue turn references a speaker by its ID.",
        "examples": [
          [
            {
              "speaker_id": "Speaker 1",
              "voice_name": "Fenrir",
              "audio_profile": "A stern and weary gatekeeper",
              "accent": "British (RP)",
              "style": "Deadpan",
              "pace": "Natural"
            },
            {
              "speaker_id": "Speaker 2",
              "voice_name": "Puck",
              "audio_profile": "A determined and courageous traveler seeking answers.",
              "accent": "American (Gen)",
              "style": "Empathetic",
              "pace": "Staccato"
            }
          ]
        ],
        "items": {
          "type": "object",
          "properties": {
            "speaker_id": {
              "type": "string",
              "title": "Speaker ID",
              "description": "Speaker identifier. Must be in \"Speaker N\" format (e.g. \"Speaker 1\")."
            },
            "voice_name": {
              "type": "string",
              "title": "Voice",
              "description": "Prebuilt Gemini voice name.",
              "enum": [
                "Achernar",
                "Achird",
                "Algenib",
                "Algieba",
                "Alnilam",
                "Aoede",
                "Autonoe",
                "Callirrhoe",
                "Charon",
                "Despina",
                "Enceladus",
                "Erinome",
                "Fenrir",
                "Gacrux",
                "Iapetus",
                "Kore",
                "Laomedeia",
                "Leda",
                "Orus",
                "Puck",
                "Pulcherrima",
                "Rasalgethi",
                "Sadachbia",
                "Sadaltager",
                "Schedar",
                "Sulafat",
                "Umbriel",
                "Vindemiatrix",
                "Zephyr",
                "Zubenelgenubi"
              ]
            },
            "audio_profile": {
              "type": "string",
              "title": "Audio Profile",
              "description": "Optional natural-language description of the persona, e.g. \"A warm and soothing narrator\"."
            },
            "accent": {
              "type": "string",
              "title": "Accent",
              "description": "Speaking accent.",
              "enum": [
                "Neutral",
                "American (Gen)",
                "American (Valley)",
                "American (South)",
                "British (RP)",
                "British (Brixton)",
                "Transatlantic",
                "Australian"
              ],
              "default": "Neutral"
            },
            "style": {
              "type": "string",
              "title": "Style",
              "description": "Emotional delivery style.",
              "enum": [
                "Vocal Smile",
                "Newscaster",
                "Whisper",
                "Empathetic",
                "Promo/Hype",
                "Deadpan"
              ],
              "default": "Empathetic"
            },
            "pace": {
              "type": "string",
              "title": "Pace",
              "description": "Speaking pace.",
              "enum": [
                "Natural",
                "Rapid Fire",
                "The Drift",
                "Staccato"
              ],
              "default": "Natural"
            }
          },
          "required": [
            "speaker_id",
            "voice_name",
            "accent",
            "style",
            "pace"
          ]
        }
      },
      "dialogue_turns": {
        "type": "array",
        "title": "Dialogue Turns",
        "name": "dialogue_turns",
        "description": "Ordered list of dialogue lines. Each turn's speaker_id must match a speaker defined above. Text may include tone tags like [shouting] or [whispers].",
        "examples": [
          [
            {
              "speaker_id": "Speaker 1",
              "text": "[shouting] Halt, traveler! The northern pass is sealed by order of the council."
            },
            {
              "speaker_id": "Speaker 2",
              "text": "[determination] I carry a message for the elder. Step aside, or I will force my way through."
            },
            {
              "speaker_id": "Speaker 1",
              "text": "[caution] No one passes. [pensive] The elder is... he's no longer receiving visitors."
            },
            {
              "speaker_id": "Speaker 2",
              "text": "It's too late. [whispers] The shadow... it reached him first. [urgency] You need to leave. [shouting] Now."
            }
          ]
        ],
        "items": {
          "type": "object",
          "properties": {
            "speaker_id": {
              "type": "string",
              "title": "Speaker ID",
              "description": "ID of the speaker delivering this line (e.g. \"Speaker 1\")."
            },
            "text": {
              "type": "string",
              "title": "Text",
              "description": "The line to speak. Supports inline tone tags. Max 10000 characters."
            }
          },
          "required": [
            "speaker_id",
            "text"
          ]
        }
      },
      "scene": {
        "type": "string",
        "title": "Scene",
        "name": "scene",
        "description": "Optional scene description that sets the acoustic setting, e.g. \"A quiet, warm room with a fireplace crackling softly.\"",
        "default": ""
      },
      "sample_context": {
        "type": "string",
        "title": "Sample Context",
        "name": "sample_context",
        "description": "Optional overall tone/style, e.g. \"Audiobook style narration. Tone is gentle and inviting.\"",
        "default": ""
      },
      "temperature": {
        "type": "number",
        "title": "Temperature",
        "name": "temperature",
        "description": "Sampling temperature (0-2). Higher values produce more varied delivery.",
        "default": 1,
        "minimum": 0,
        "maximum": 2
      }
    }
  },
  {
    "id": "gemini-2-5-pro-tts",
    "name": "Gemini 2.5 Pro TTS",
    "endpoint": "gemini-2-5-pro-tts",
    "family": "gemini-tts",
    "description": "Gemini 2.5 Pro TTS is Google's premium text-to-speech model for studio-quality, high-fidelity multi-speaker audio with expressive control over voice, accent, emotional style, and pace.",
    "required": [
      "speakers",
      "dialogue_turns"
    ],
    "inputs": {
      "speakers": {
        "type": "array",
        "title": "Speakers",
        "name": "speakers",
        "description": "List of speaker voice configurations. Each dialogue turn references a speaker by its ID.",
        "examples": [
          [
            {
              "speaker_id": "Speaker 1",
              "voice_name": "Fenrir",
              "audio_profile": "A stern and weary gatekeeper",
              "accent": "British (RP)",
              "style": "Deadpan",
              "pace": "Natural"
            },
            {
              "speaker_id": "Speaker 2",
              "voice_name": "Puck",
              "audio_profile": "A determined and courageous traveler seeking answers.",
              "accent": "American (Gen)",
              "style": "Empathetic",
              "pace": "Staccato"
            }
          ]
        ],
        "items": {
          "type": "object",
          "properties": {
            "speaker_id": {
              "type": "string",
              "title": "Speaker ID",
              "description": "Speaker identifier. Must be in \"Speaker N\" format (e.g. \"Speaker 1\")."
            },
            "voice_name": {
              "type": "string",
              "title": "Voice",
              "description": "Prebuilt Gemini voice name.",
              "enum": [
                "Achernar",
                "Achird",
                "Algenib",
                "Algieba",
                "Alnilam",
                "Aoede",
                "Autonoe",
                "Callirrhoe",
                "Charon",
                "Despina",
                "Enceladus",
                "Erinome",
                "Fenrir",
                "Gacrux",
                "Iapetus",
                "Kore",
                "Laomedeia",
                "Leda",
                "Orus",
                "Puck",
                "Pulcherrima",
                "Rasalgethi",
                "Sadachbia",
                "Sadaltager",
                "Schedar",
                "Sulafat",
                "Umbriel",
                "Vindemiatrix",
                "Zephyr",
                "Zubenelgenubi"
              ]
            },
            "audio_profile": {
              "type": "string",
              "title": "Audio Profile",
              "description": "Optional natural-language description of the persona, e.g. \"A warm and soothing narrator\"."
            },
            "accent": {
              "type": "string",
              "title": "Accent",
              "description": "Speaking accent.",
              "enum": [
                "Neutral",
                "American (Gen)",
                "American (Valley)",
                "American (South)",
                "British (RP)",
                "British (Brixton)",
                "Transatlantic",
                "Australian"
              ],
              "default": "Neutral"
            },
            "style": {
              "type": "string",
              "title": "Style",
              "description": "Emotional delivery style.",
              "enum": [
                "Vocal Smile",
                "Newscaster",
                "Whisper",
                "Empathetic",
                "Promo/Hype",
                "Deadpan"
              ],
              "default": "Empathetic"
            },
            "pace": {
              "type": "string",
              "title": "Pace",
              "description": "Speaking pace.",
              "enum": [
                "Natural",
                "Rapid Fire",
                "The Drift",
                "Staccato"
              ],
              "default": "Natural"
            }
          },
          "required": [
            "speaker_id",
            "voice_name",
            "accent",
            "style",
            "pace"
          ]
        }
      },
      "dialogue_turns": {
        "type": "array",
        "title": "Dialogue Turns",
        "name": "dialogue_turns",
        "description": "Ordered list of dialogue lines. Each turn's speaker_id must match a speaker defined above. Text may include tone tags like [shouting] or [whispers].",
        "examples": [
          [
            {
              "speaker_id": "Speaker 1",
              "text": "[shouting] Halt, traveler! The northern pass is sealed by order of the council."
            },
            {
              "speaker_id": "Speaker 2",
              "text": "[determination] I carry a message for the elder. Step aside, or I will force my way through."
            },
            {
              "speaker_id": "Speaker 1",
              "text": "[caution] No one passes. [pensive] The elder is... he's no longer receiving visitors."
            },
            {
              "speaker_id": "Speaker 2",
              "text": "It's too late. [whispers] The shadow... it reached him first. [urgency] You need to leave. [shouting] Now."
            }
          ]
        ],
        "items": {
          "type": "object",
          "properties": {
            "speaker_id": {
              "type": "string",
              "title": "Speaker ID",
              "description": "ID of the speaker delivering this line (e.g. \"Speaker 1\")."
            },
            "text": {
              "type": "string",
              "title": "Text",
              "description": "The line to speak. Supports inline tone tags. Max 10000 characters."
            }
          },
          "required": [
            "speaker_id",
            "text"
          ]
        }
      },
      "scene": {
        "type": "string",
        "title": "Scene",
        "name": "scene",
        "description": "Optional scene description that sets the acoustic setting, e.g. \"A quiet, warm room with a fireplace crackling softly.\"",
        "default": ""
      },
      "sample_context": {
        "type": "string",
        "title": "Sample Context",
        "name": "sample_context",
        "description": "Optional overall tone/style, e.g. \"Audiobook style narration. Tone is gentle and inviting.\"",
        "default": ""
      },
      "temperature": {
        "type": "number",
        "title": "Temperature",
        "name": "temperature",
        "description": "Sampling temperature (0-2). Higher values produce more varied delivery.",
        "default": 1,
        "minimum": 0,
        "maximum": 2
      }
    }
  }
];

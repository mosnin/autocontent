/**
 * marketer.sh Studio model catalog — Video-to-video models.
 *
 * Data is vendor-supplied and kept verbatim: ids, names, endpoints, provider
 * attribution and the full `inputs` schemas describe what actually runs.
 * Do not hand-edit — every studio control derives from these schemas.
 *
 * 36 models.
 */
import type { ModelDefinition } from '../types';

export const v2vModels: ModelDefinition[] = [
  {
    "id": "video-watermark-remover",
    "name": "AI Video Watermark Remover",
    "endpoint": "video-watermark-remover",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "Remove watermarks, logos, captions, and unwanted text from videos.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "kling-v2.6-std-motion-control",
    "name": "Kling 2.6 Std Motion Control",
    "endpoint": "kling-v2.6-std-motion-control",
    "family": "kling",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "promptRequired": true,
    "description": "Kling v2.6 Pro Motion Control allows precise control over camera movement, subject motion, and scene dynamics during video generation.",
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-std-motion-control",
    "name": "Kling 3.0 Std Motion Control",
    "endpoint": "kling-v3.0-std-motion-control",
    "family": "kling",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "description": "Kling V3.0 Standard Motion Control allows for precise control over the camera and subject movement in generated videos.",
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-v3.0-pro-motion-control",
    "name": "Kling 3.0 Pro Motion Control",
    "endpoint": "kling-v3.0-pro-motion-control",
    "family": "kling",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "description": "Kling V3.0 Pro Motion Control provides the highest level of detail and control for video generation.",
    "provider": "kling",
    "provider_name": "Kling AI"
  }
,
  {
    "id": "ai-video-face-swap",
    "name": "AI Video Face Swap",
    "endpoint": "ai-video-face-swap",
    "family": "tools",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": false,
    "description": "Replace faces in videos with stunning realism.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "mmaudio-v2-video-to-video",
    "name": "MMAudio v2 Video to Video",
    "endpoint": "mmaudio-v2/video-to-video",
    "family": "mmaudio",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "MMAudio-v2 generates high-quality, synchronized audio from video or text inputs.",
    "provider": "mmaudio",
    "provider_name": "MMAudio"
  },
  {
    "id": "runway-aleph-v2v",
    "name": "Runway Aleph V2V",
    "endpoint": "runway-aleph-v2v",
    "family": "runway",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Transform any input video into a new visual style or scene while preserving motion and structure.",
    "provider": "runway",
    "provider_name": "RunwayML"
  },
  {
    "id": "luma-modify-video",
    "name": "Luma Modify Video",
    "endpoint": "luma-modify-video",
    "family": "luma",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Luma Modify Video lets you transform an existing video into a new creative scene while keeping the original motion and timing intact.",
    "provider": "luma",
    "provider_name": "Luma AI"
  },
  {
    "id": "ai-dance-effects",
    "name": "AI Dance Effects",
    "endpoint": "ai-dance-effects",
    "family": "effects",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "description": "Bring your characters and worlds to life with AI Dance Effects — a creative video effect that adds playful, dynamic, and cinematic motion to your generations.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "ai-video-upscaler",
    "name": "AI Video Upscaler",
    "endpoint": "ai-video-upscaler",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "The AI Video Upscaler is a powerful tool designed to enhance the resolution and quality of videos.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "wan2.2-edit-video",
    "name": "Wan2.2 Edit Video",
    "endpoint": "wan2.2-edit-video",
    "family": "wan2.2",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Easily modify existing videos using simple text commands.",
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "heygen-video-translate",
    "name": "HeyGen Video Translate",
    "endpoint": "heygen-video-translate",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "Convert any video into 175+ languages with synchronized voice translation, AI-voice cloning, and accurate lip sync.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "topaz-video-upscale",
    "name": "Topaz Video Upscale",
    "endpoint": "topaz-video-upscale",
    "family": "topaz",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "The AI Video Upscaler is a powerful tool designed to enhance the resolution and quality of videos.",
    "provider": "topaz",
    "provider_name": "Topaz Labs"
  },
  {
    "id": "ai-video-upscaler-pro",
    "name": "AI Video Upscaler Pro",
    "endpoint": "ai-video-upscaler-pro",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "The AI Video Upscaler is a powerful tool designed to enhance the resolution and quality of videos.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "remix-video",
    "name": "Remix Video",
    "endpoint": "remix-video",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "Transform and resize your videos effortlessly with remix video tool.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "kling-o1-video-edit",
    "name": "Kling O1 Video Edit",
    "endpoint": "kling-o1-video-edit",
    "family": "kling-o1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Kling O1 Video Edit lets you send an existing video clip plus an instruction/prompt to edit or transform the clip while preserving temporal coherence and subject identity.",
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-o1-video-edit-fast",
    "name": "Kling O1 Video Edit Fast",
    "endpoint": "kling-o1-video-edit-fast",
    "family": "kling-o1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Video Edit Fast is the lightweight, high-speed editing mode of Kling O1.",
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "kling-o1-standard-video-edit",
    "name": "Kling O1 Standard Video Edit",
    "endpoint": "kling-o1-standard-video-edit",
    "family": "kling-o1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Kling O1 Standard Video-to-Video Edit modifies an existing video while preserving its original structure, motion, and realism.",
    "provider": "kling",
    "provider_name": "Kling AI"
  },
  {
    "id": "wan2.2-spicy-video-extend",
    "name": "Wan2.2 Spicy Video Extend",
    "endpoint": "wan2.2-spicy-video-extend",
    "family": "wan2.2",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Wan-2.2-spicy Video Extend continues an existing video by generating new frames that match the original style but add stronger motion, bolder effects, and spicier dramatics.",
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "seedance-v1.5-pro-video-extend",
    "name": "Seedance v1.5 Pro Video Extend",
    "endpoint": "seedance-v1.5-pro-video-extend",
    "family": "seedance-v1.5-pro",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Seedance v1.5 Pro Video Extend continues an existing video by generating additional frames that match the original scene’s style, lighting, motion, and mood.",
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "seedance-v1.5-pro-video-extend-fast",
    "name": "Seedance v1.5 Pro Video Extend Fast",
    "endpoint": "seedance-v1.5-pro-video-extend-fast",
    "family": "seedance-v1.5-pro",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Seedance v1.5 Pro Video Extend Fast quickly extends an existing video by generating a short continuation that matches the original style, motion, and lighting.",
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "add-video-watermark",
    "name": "Add Video Watermark",
    "endpoint": "add-video-watermark",
    "family": "watermark",
    "videoField": "video_url",
    "imageField": "watermark_image_url",
    "hasPrompt": false,
    "description": "Add custom watermark to videos with adjustable position, opacity, and size.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "seedance-2-watermark-remover",
    "name": "Seedance 2 Watermark Remover",
    "endpoint": "seedance-2.0-watermark-remover",
    "family": "sd-v2.0",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "🎉 FREE for a limited time — Remove SD 2.0 watermarks from videos using LaMa AI inpainting.",
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "ai-captions",
    "name": "AI Captions",
    "endpoint": "ai-captions",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "Add AI-generated animated captions to any video using Vadoo's caption engine.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "ltx-2.3-video-extend",
    "name": "LTX 2.3 Video Extend",
    "endpoint": "ltx-2.3-video-extend",
    "family": "ltx2.3",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "LTX-2.3 Video Extend seamlessly continues an existing video clip by generating additional frames that match the original motion, style, and scene composition.",
    "provider": "lightricks",
    "provider_name": "Lightricks"
  },
  {
    "id": "seedance-2-video-watermark-remover-pro",
    "name": "Seedance 2 Video Watermark Remover Pro",
    "endpoint": "seedance-2-video-watermark-remover-pro",
    "family": "sd-v2.0",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "SD 2 Video Watermark Remover Pro uses the SD 2 AI model to remove watermarks, logos, and overlaid text from videos with high accuracy.",
    "provider": "bytedance",
    "provider_name": "ByteDance"
  },
  {
    "id": "pixverse-v6-extend",
    "name": "Pixverse v6 Extend",
    "endpoint": "pixverse-v6-extend",
    "family": "pixverse-v6",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Extend any existing video with new frames using PixVerse V6.",
    "provider": "pixverse",
    "provider_name": "Pixverse"
  },
  {
    "id": "wan2.7-video-extend",
    "name": "Wan2.7 Video Extend",
    "endpoint": "wan2.7-video-extend",
    "family": "wan2.7",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Extend existing videos seamlessly with Wan 2.7.",
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "wan2.7-video-edit",
    "name": "Wan2.7 Video Edit",
    "endpoint": "wan2.7-video-edit",
    "family": "wan2.7",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Perform prompt-driven video editing with multi-image reference support.",
    "provider": "alibaba",
    "provider_name": "Alibaba"
  },
  {
    "id": "happy-horse-1-video-edit-1080p",
    "name": "Happy Horse 1 Video Edit 1080P",
    "endpoint": "happy-horse-1-video-edit-1080p",
    "family": "happy-horse-1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Happy Horse 1.0 Video Edit (1080p) - modify an input video at 1080p using a natural-language instruction with optional reference images.",
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1-video-edit-720p",
    "name": "Happy Horse 1 Video Edit 720P",
    "endpoint": "happy-horse-1-video-edit-720p",
    "family": "happy-horse-1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Happy Horse 1.0 Video Edit (720p) - modify an input video at 720p using a natural-language instruction with optional reference images.",
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1.1-video-edit-1080p",
    "name": "Happy Horse 1.1 Video Edit 1080P",
    "endpoint": "happy-horse-1.1-video-edit-1080p",
    "family": "happy-horse-1.1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Happy Horse 1.1 Video Edit (1080p) — modify an input video using natural-language instructions with optional reference images.",
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "happy-horse-1.1-video-edit-720p",
    "name": "Happy Horse 1.1 Video Edit 720P",
    "endpoint": "happy-horse-1.1-video-edit-720p",
    "family": "happy-horse-1.1",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Happy Horse 1.1 Video Edit (720p) — modify an input video using natural-language instructions with optional reference images.",
    "provider": "happy-horse",
    "provider_name": "Happy Horse"
  },
  {
    "id": "gemini-omni-video-edit",
    "name": "Gemini Omni Video Edit",
    "endpoint": "gemini-omni-video-edit",
    "family": "gemini-omni",
    "videoField": "video_url",
    "hasPrompt": true,
    "description": "Gemini Omni Video Edit — natively multimodal video-to-video editing.",
    "provider": "google",
    "provider_name": "Google"
  },
  {
    "id": "video-background-remover",
    "name": "Video Background Remover",
    "endpoint": "video-background-remover",
    "family": "tools",
    "videoField": "video_url",
    "hasPrompt": false,
    "description": "Video Background Remover automatically removes the background from any video, producing a clean cutout of the subject with a transparent or solid-color backdrop.",
    "provider": "marketer",
    "provider_name": "Marketer.sh"
  },
  {
    "id": "kling-v2.6-pro-motion-control",
    "name": "Kling v2.6 Pro Motion Control",
    "endpoint": "kling-v2.6-pro-motion-control",
    "family": "kling-v2.6",
    "videoField": "video_url",
    "imageField": "image_url",
    "hasPrompt": true,
    "promptRequired": true,
    "description": "Kling v2.6 Pro Motion Control allows precise control over camera movement, subject motion, and scene dynamics during video generation.",
    "provider": "kling",
    "provider_name": "Kling AI"
  }
];

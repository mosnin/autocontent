import "server-only";

import type { EditorCatalog } from "@/components/app/playbooks/playbook-editor";
import type { AudioProviders, Kit, ScriptModelOption, StylePreset, VideoModelOption } from "./types";
import { safe } from "./workspace-server";

/** Providers, kits and style presets for the playbook editor. Each degrades to null. */
export async function getEditorCatalog(): Promise<EditorCatalog> {
  const [videoModels, scriptModels, audio, kits, presets] = await Promise.all([
    safe<VideoModelOption[]>("/api/v1/providers/video-models"),
    safe<ScriptModelOption[]>("/api/v1/providers/script-models"),
    safe<AudioProviders>("/api/v1/providers/audio"),
    safe<Kit[]>("/api/v1/kits"),
    safe<StylePreset[]>("/api/v1/style-presets"),
  ]);
  return { videoModels, scriptModels, audio, kits, presets };
}

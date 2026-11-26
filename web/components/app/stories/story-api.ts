import { proxyFetch } from "@/lib/proxy-fetch";
import type { Story, StoryAspect, StoryScene } from "./types";

const base = (id?: string) => `/api/v1/stories${id ? `/${encodeURIComponent(id)}` : ""}`;

export const storyApi = {
  create: (body: { mode: "idea" | "script"; source: string; requirement: string; style: string; aspect: StoryAspect }) => proxyFetch<Story>(base(), "POST", body),
  saveScript: (id: string, scenes: StoryScene[], title?: string) => proxyFetch<Story>(`${base(id)}/script`, "PUT", { scenes, title }),
  revise: (id: string, note: string) => proxyFetch<Story>(`${base(id)}/script/revise`, "POST", { note }),
  storyboard: (id: string) => proxyFetch<Story>(`${base(id)}/storyboard`, "POST"),
  redraw: (id: string, idx: number, firstFrame?: string) => proxyFetch<Story>(`${base(id)}/shots/${idx}/regenerate`, "POST", firstFrame ? { first_frame: firstFrame } : {}),
  render: (id: string) => proxyFetch<Story>(`${base(id)}/render`, "POST"),
  approve: (id: string) => proxyFetch<Story>(`${base(id)}/render/approve`, "POST"),
  decline: (id: string) => proxyFetch<Story>(`${base(id)}/render/decline`, "POST"),
  retry: (id: string) => proxyFetch<Story>(`${base(id)}/retry`, "POST"),
};

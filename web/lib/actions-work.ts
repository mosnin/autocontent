"use server";

// Server actions for the work departments (Playbooks). Same API calls as
// createNicheAction / updateNicheAction in lib/actions.ts, but they land on
// the new /playbooks routes instead of the retired /dashboard.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "./action-state";
import { api } from "./api";
import { playbookPayload } from "./playbook-form";
import type { Niche } from "./types";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function createPlaybookAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const built = playbookPayload(fd);
  if (!built.ok) return built;
  let niche: Niche;
  try {
    niche = await api<Niche>("/api/v1/niches", { method: "POST", body: JSON.stringify(built.payload) });
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  revalidatePath("/playbooks");
  revalidatePath("/", "layout");
  redirect(`/playbooks/${niche.id}`);
}

export async function updatePlaybookAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("niche_id") || "").trim();
  if (!id) return { ok: false, error: "Missing playbook id." };
  const built = playbookPayload(fd);
  if (!built.ok) return built;
  try {
    await api<Niche>(`/api/v1/niches/${id}`, { method: "PUT", body: JSON.stringify(built.payload) });
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
  revalidatePath("/playbooks");
  revalidatePath(`/playbooks/${id}`);
  redirect(`/playbooks/${id}`);
}

export async function archivePlaybookAction(id: string): Promise<ActionState> {
  try {
    await api(`/api/v1/niches/${id}`, { method: "DELETE" });
  } catch (e) {
    // DELETE returns 204 with no body; api() then fails to parse JSON.
    if (!/JSON|Unexpected end/i.test(msg(e))) return { ok: false, error: msg(e) };
  }
  revalidatePath("/playbooks");
  return { ok: true };
}

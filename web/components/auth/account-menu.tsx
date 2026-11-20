"use client";

import { LogOut, Plus, Settings, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Input, MenuButton, MenuItem, Modal, Notice, PersonAvatar, WorkspaceLogo, cx } from "@/design-system";
import { createAnotherWorkspace, switchWorkspace } from "@/lib/auth/actions";
import { roleLabel } from "@/lib/auth/catalog";
import { authClient } from "@/lib/auth/client";

export interface WorkspaceOption {
  id: string;
  name: string;
  role: string;
}

/**
 * The workspace row at the top of the sidebar, as a switcher: the current
 * workspace, the others the person belongs to, and "Create workspace".
 */
export function WorkspaceSwitcher({ current, workspaces, actions, preview }: { current: WorkspaceOption; workspaces: WorkspaceOption[]; actions?: ReactNode; preview?: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (id: string, close: () => void) => {
    close();
    if (id === current.id || preview) return;
    const r = await switchWorkspace(id);
    if (r.ok) {
      router.push("/home");
      router.refresh();
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || preview) return;
    setBusy(true);
    setError(null);
    const r = await createAnotherWorkspace(name);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCreating(false);
    setName("");
    router.push("/onboarding");
    router.refresh();
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2.5">
      <div className="min-w-0 flex-1">
        <MenuButton
          label="Workspaces"
          trigger={(open) => (
            <button type="button" aria-haspopup="listbox" aria-expanded={open} className="ds-press flex w-full min-w-0 items-center gap-2 rounded-ds-sm px-1.5 py-1 text-left hover:bg-surface-2" data-testid="workspace-switcher">
              <WorkspaceLogo name={current.name} />
              <span className="truncate text-[13.5px] font-medium">{current.name}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              {workspaces.map((w) => (
                <MenuItem key={w.id} selected={w.id === current.id} icon={<WorkspaceLogo name={w.name} size={16} />} hint={roleLabel(w.role)} onClick={() => void pick(w.id, close)}>
                  {w.name}
                </MenuItem>
              ))}
              <div className="my-1 h-px bg-hairline" />
              <MenuItem icon={<Plus />} onClick={() => (close(), setCreating(true))}>
                Create workspace
              </MenuItem>
            </>
          )}
        </MenuButton>
      </div>
      {actions}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a workspace"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="create-workspace" loading={busy}>
              Create
            </Button>
          </>
        }
      >
        <form id="create-workspace" onSubmit={create} className="space-y-3">
          <Field label="Name" hint="A separate brand or client: its own work, people and billing. You'll be its owner.">
            <Input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Notice error={error} />
        </form>
      </Modal>
    </div>
  );
}

/** The person at the bottom of the sidebar: their name, and Security and Sign out. */
export function UserMenu({ name, email, preview }: { name: string; email: string; preview?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    if (busy || preview) return;
    setBusy(true);
    await authClient.signOut().catch(() => undefined);
    window.location.assign("/sign-in");
  };
  return (
    <MenuButton
      label="Account"
      up
      trigger={(open) => (
        <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Account menu" className={cx("ds-press flex min-w-0 items-center gap-2 rounded-ds-sm px-1 py-0.5 hover:bg-surface-2")} data-testid="user-menu">
          <PersonAvatar name={name || email} size={22} />
          <span className="min-w-0 truncate text-[12.5px] text-fg-muted">{name || email}</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 py-1.5 text-[12px] text-fg-muted">
            <div className="truncate text-[13px] text-fg">{name || email}</div>
            <div className="truncate">{email}</div>
          </div>
          <div className="my-1 h-px bg-hairline" />
          <MenuItem icon={<ShieldCheck />} onClick={() => (close(), router.push("/settings#security"))}>
            Security
          </MenuItem>
          <MenuItem icon={<Settings />} onClick={() => (close(), router.push("/settings"))}>
            Settings
          </MenuItem>
          <MenuItem icon={<LogOut />} onClick={() => (close(), void signOut())} disabled={busy}>
            Sign out
          </MenuItem>
        </>
      )}
    </MenuButton>
  );
}



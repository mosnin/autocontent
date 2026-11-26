"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Modal, Notice, Segmented, usePending, useAllowed, NotAllowed } from "@/design-system";
import { proxyFetch } from "@/lib/proxy-fetch";
import { SEO_PLUGIN_LABEL, type WordPressConnection } from "@/lib/seo";

type Plugin = "yoast" | "rankmath" | "none";

/**
 * Connect WordPress: one focused sheet. Site address, username and an
 * application password; the server verifies them before saving and seals the
 * password. Once saved the password is never shown again, only "saved".
 */
export function WordPressConnectModal({ open, onClose, current, onSaved }: { open: boolean; onClose: () => void; current: WordPressConnection | null; onSaved?: (c: WordPressConnection) => void }) {
  const router = useRouter();
  const canConnect = useAllowed("integration:connect");
  const canDisconnect = useAllowed("integration:disconnect");
  const connected = Boolean(current?.connected);
  const [site, setSite] = useState(current?.site_url ?? "");
  const [user, setUser] = useState(current?.username ?? "");
  const [password, setPassword] = useState("");
  const [plugin, setPlugin] = useState<Plugin>((current?.seo_plugin as Plugin) ?? "yoast");
  const [saved, setSaved] = useState<WordPressConnection | null>(null);
  const { busy, error, run } = usePending<"save" | "remove">();

  const close = () => {
    setPassword("");
    setSaved(null);
    onClose();
  };

  const save = () =>
    run("save", async () => {
      const c = await proxyFetch<WordPressConnection>("/api/v1/integrations/wordpress", "PUT", { site_url: site.trim(), username: user.trim(), app_password: password, seo_plugin: plugin });
      setPassword("");
      setSaved(c);
      onSaved?.(c);
      router.refresh();
    });

  const remove = () =>
    run("remove", async () => {
      await proxyFetch("/api/v1/integrations/wordpress", "DELETE");
      router.refresh();
      close();
    });

  const secretsOff = current ? current.secrets_configured === false : false;

  return (
    <Modal
      open={open}
      onClose={close}
      title={connected ? "WordPress" : "Connect WordPress"}
      footer={
        saved ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            {connected && canDisconnect && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={() => void remove()} loading={busy === "remove"} disabled={busy !== null}>
                Disconnect
              </Button>
            )}
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="wp-connect" variant="primary" loading={busy === "save"} disabled={!canConnect || secretsOff || busy !== null || !site || !user || password.length < 8}>
              {connected ? "Save" : "Connect"}
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <div className="ds-enter space-y-2 text-[13px]">
          <p className="font-medium">Connected to {saved.site_url?.replace(/^https:\/\//, "")}</p>
          <p className="text-fg-muted">
            {saved.can_publish === false
              ? "This user can save drafts but can't publish. Use an Editor or Administrator to publish live."
              : `Articles can go out as drafts or live posts, with ${SEO_PLUGIN_LABEL[saved.seo_plugin ?? "none"]} fields filled in.`}
          </p>
        </div>
      ) : (
        <form
          id="wp-connect"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {!canConnect && <NotAllowed>Owners, admins and marketers connect integrations.</NotAllowed>}
          {secretsOff && <Notice error="This server can't store integration passwords yet. Ask whoever runs it to set the integration secret key." />}
          <Field label="Site address">
            <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://blog.example.com" inputMode="url" autoComplete="url" autoFocus />
          </Field>
          <Field label="Username">
            <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Application password" hint={connected ? "Saved. Enter it again to change anything here." : "WordPress → Users → Profile → Application Passwords. Stored encrypted; never shown again."}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={connected ? "••••  ••••  ••••  ••••" : "xxxx xxxx xxxx xxxx"} />
          </Field>
          <div className="space-y-1.5">
            <span className="block text-[12.5px] font-medium">SEO plugin</span>
            <Segmented label="SEO plugin" value={plugin} onChange={setPlugin} options={[{ value: "yoast", label: "Yoast" }, { value: "rankmath", label: "Rank Math" }, { value: "none", label: "None" }]} />
          </div>
          <Notice error={error} />
        </form>
      )}
    </Modal>
  );
}

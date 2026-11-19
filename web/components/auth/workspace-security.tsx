"use client";

import { Building2, CheckCircle2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, CodeBlock, ConfirmModal, EmptyLine, Field, Input, List, ListRow, NotAllowed, Notice, Section, Segmented, StatusBadge, SwitchRow, Table, Textarea, Time, useAllowed, usePending } from "@/design-system";
import { authClient, authErrorMessage } from "@/lib/auth/client";

export interface SsoProviderRow {
  providerId: string;
  domain: string;
  issuer: string;
  type: "oidc" | "saml";
  domainVerified: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorEmail: string;
  actorType: string;
  action: string;
  outcome: "success" | "denied" | "failure";
  target: string | null;
  ip: string | null;
}

export interface WorkspaceSecurityProps {
  organizationId: string;
  requireTwoFactor: boolean;
  providers: SsoProviderRow[];
  /** Null when the role can't read the security log. */
  audit: AuditEntry[] | null;
  baseUrl: string;
  preview?: boolean;
}

const OUTCOME_TONE = { success: "positive", denied: "attention", failure: "negative" } as const;

export function WorkspaceSecurity({ organizationId, requireTwoFactor, providers, audit, baseUrl, preview }: WorkspaceSecurityProps) {
  const router = useRouter();
  const canManage = useAllowed("security:manage");
  const [required, setRequired] = useState(requireTwoFactor);
  const toggle = usePending<"2fa">();

  const setRequire = (v: boolean) =>
    void toggle.run("2fa", async () => {
      if (!preview) {
        const { error } = await authClient.organization.update({ organizationId, data: { requireTwoFactor: v } });
        if (error) throw new Error(authErrorMessage(error, "The setting wasn't saved."));
      }
      setRequired(v);
      router.refresh();
    });

  return (
    <>
      <Section title="Two-factor">
        <SwitchRow
          label="Require two-factor for everyone"
          detail="People without it are sent to set it up before they can use the workspace. The backend refuses their requests until they do."
          checked={required}
          onChange={setRequire}
          disabled={!canManage || toggle.busy !== null}
        />
        {!canManage && <NotAllowed className="mt-2">Owners and admins change security settings.</NotAllowed>}
        <Notice error={toggle.error} />
      </Section>

      <SsoSection organizationId={organizationId} providers={providers} canManage={canManage} baseUrl={baseUrl} preview={preview} />

      <Section title="Security log">
        {audit === null ? (
          <NotAllowed>Owners and admins see the security log.</NotAllowed>
        ) : audit.length === 0 ? (
          <EmptyLine>Sign-ins, role changes, invitations and refusals in this workspace will be listed here.</EmptyLine>
        ) : (
          <Table
            noun="events"
            pageSize={50}
            rows={audit}
            rowKey={(r) => r.id}
            columns={[
              { key: "at", header: "When", cell: (r) => <Time iso={r.at} /> },
              { key: "who", header: "Who", cell: (r) => <span className="truncate">{r.actorEmail || r.actorType}</span> },
              { key: "what", header: "What", cell: (r) => <span className="font-mono text-[12px]">{r.action}</span> },
              { key: "outcome", header: "Result", cell: (r) => <StatusBadge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</StatusBadge> },
              { key: "ip", header: "IP", cell: (r) => <span className="text-fg-muted">{r.ip ?? ""}</span> },
            ]}
          />
        )}
      </Section>
    </>
  );
}

function SsoSection({ organizationId, providers, canManage, baseUrl, preview }: { organizationId: string; providers: SsoProviderRow[]; canManage: boolean; baseUrl: string; preview?: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"oidc" | "saml">("oidc");
  const [form, setForm] = useState({ providerId: "", domain: "", issuer: "", clientId: "", clientSecret: "", discovery: "", entryPoint: "", cert: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dns, setDns] = useState<{ providerId: string; token: string } | null>(null);
  const [remove, setRemove] = useState<SsoProviderRow | null>(null);
  const ops = usePending<string>();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || preview) return;
    setBusy(true);
    setError(null);
    const providerId = form.providerId.trim().toLowerCase();
    const body =
      kind === "oidc"
        ? { providerId, organizationId, domain: form.domain.trim().toLowerCase(), issuer: form.issuer.trim(), oidcConfig: { clientId: form.clientId.trim(), clientSecret: form.clientSecret, discoveryEndpoint: form.discovery.trim() || undefined, pkce: true } }
        : { providerId, organizationId, domain: form.domain.trim().toLowerCase(), issuer: form.issuer.trim(), samlConfig: { entryPoint: form.entryPoint.trim(), cert: form.cert.trim(), callbackUrl: `${baseUrl}/api/auth/sso/saml2/sp/acs/${providerId}`, wantAssertionsSigned: true, spMetadata: {} } };
    const { data, error } = await authClient.sso.register(body as never);
    setBusy(false);
    if (error) return setError(authErrorMessage(error, "The provider wasn't added."));
    const token = (data as { domainVerificationToken?: string } | null)?.domainVerificationToken;
    if (token) setDns({ providerId, token });
    setAdding(false);
    setForm({ providerId: "", domain: "", issuer: "", clientId: "", clientSecret: "", discovery: "", entryPoint: "", cert: "" });
    router.refresh();
  };

  return (
    <Section title="Single sign-on" action={canManage && !adding ? <Button size="sm" onClick={() => setAdding(true)}><Building2 /> Add a provider</Button> : undefined}>
      <div className="space-y-3">
        {providers.length === 0 && !adding && <EmptyLine>No SSO provider. Connect Okta, Entra ID, Google Workspace or any OIDC or SAML identity provider.</EmptyLine>}
        {providers.length > 0 && (
          <List>
            {providers.map((p) => (
              <ListRow key={p.providerId}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="truncate">{p.providerId}</span>
                    <StatusBadge>{p.type.toUpperCase()}</StatusBadge>
                    {p.domainVerified ? <StatusBadge tone="positive">Domain verified</StatusBadge> : <StatusBadge tone="attention">Domain not verified</StatusBadge>}
                  </div>
                  <div className="truncate text-[12px] text-fg-muted">
                    @{p.domain} · {p.issuer}
                  </div>
                </div>
                {canManage && !p.domainVerified && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={ops.busy === `verify:${p.providerId}`}
                    onClick={() =>
                      void ops.run(`verify:${p.providerId}`, async () => {
                        if (preview) return;
                        const v = await authClient.sso.verifyDomain({ providerId: p.providerId });
                        if (v.error) {
                          const r = await authClient.sso.requestDomainVerification({ providerId: p.providerId });
                          const token = (r.data as { domainVerificationToken?: string } | null)?.domainVerificationToken;
                          if (token) setDns({ providerId: p.providerId, token });
                          throw new Error("The DNS record isn't there yet. Add it, wait a few minutes, then verify again.");
                        }
                        router.refresh();
                      })
                    }
                  >
                    <CheckCircle2 /> Verify domain
                  </Button>
                )}
                {canManage && (
                  <Button size="sm" variant="ghost" aria-label={`Remove ${p.providerId}`} onClick={() => setRemove(p)}>
                    <Trash2 />
                  </Button>
                )}
              </ListRow>
            ))}
          </List>
        )}
        <Notice error={ops.error} />
        {dns && (
          <div className="space-y-2 rounded-ds-lg border border-hairline bg-surface p-4 text-[12.5px] text-fg-muted">
            <p>Prove you own the domain: add this TXT record at your DNS host, then press Verify domain.</p>
            <CodeBlock code={`_marketer-verification-${dns.providerId}  TXT  ${dns.token}`} />
          </div>
        )}
        {adding && (
          <form onSubmit={register} className="space-y-3 rounded-ds-lg border border-hairline bg-surface p-4">
            <Segmented label="Protocol" value={kind} onChange={setKind} options={[{ value: "oidc", label: "OIDC" }, { value: "saml", label: "SAML" }]} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider id" hint="Lowercase, no spaces, e.g. acme-okta.">
                <Input required pattern="[a-z0-9-]{3,40}" value={form.providerId} onChange={set("providerId")} />
              </Field>
              <Field label="Email domain" hint="People with this domain use this provider.">
                <Input required value={form.domain} onChange={set("domain")} placeholder="acme.com" />
              </Field>
            </div>
            <Field label="Issuer URL">
              <Input required type="url" value={form.issuer} onChange={set("issuer")} placeholder="https://acme.okta.com" />
            </Field>
            {kind === "oidc" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client id">
                    <Input required value={form.clientId} onChange={set("clientId")} />
                  </Field>
                  <Field label="Client secret">
                    <Input required type="password" autoComplete="off" value={form.clientSecret} onChange={set("clientSecret")} />
                  </Field>
                </div>
                <Field label="Discovery URL (optional)" hint="Defaults to the issuer's /.well-known/openid-configuration.">
                  <Input type="url" value={form.discovery} onChange={set("discovery")} />
                </Field>
                <p className="text-[12px] text-fg-muted">Redirect URI for your identity provider: {baseUrl}/api/auth/sso/callback/{form.providerId || "<provider id>"}</p>
              </>
            ) : (
              <>
                <Field label="IdP sign-in URL">
                  <Input required type="url" value={form.entryPoint} onChange={set("entryPoint")} />
                </Field>
                <Field label="IdP signing certificate (PEM)">
                  <Textarea required rows={4} value={form.cert} onChange={set("cert")} className="font-mono text-[12px]" />
                </Field>
                <p className="text-[12px] text-fg-muted">ACS URL for your identity provider: {baseUrl}/api/auth/sso/saml2/sp/acs/{form.providerId || "<provider id>"}</p>
              </>
            )}
            <Notice error={error} />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={busy}>
                Add provider
              </Button>
              <Button type="button" variant="ghost" onClick={() => (setAdding(false), setError(null))}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {!canManage && <NotAllowed>Owners and admins configure single sign-on.</NotAllowed>}
      </div>
      <ConfirmModal
        open={remove !== null}
        onClose={() => setRemove(null)}
        title={`Remove ${remove?.providerId}?`}
        confirmLabel="Remove"
        danger
        busy={ops.busy === "remove"}
        error={ops.error}
        onConfirm={() =>
          void ops.run("remove", async () => {
            if (preview || !remove) return;
            const { error } = await authClient.sso.deleteProvider({ providerId: remove.providerId });
            if (error) throw new Error(authErrorMessage(error, "It wasn't removed."));
            setRemove(null);
            router.refresh();
          })
        }
      >
        <p>People at @{remove?.domain} sign in with a password, passkey or Google instead.</p>
      </ConfirmModal>
    </Section>
  );
}

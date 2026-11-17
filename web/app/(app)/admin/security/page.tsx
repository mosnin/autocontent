import { AdminFrame } from "@/components/app/admin/admin-frame";
import { ButtonLink, StatusBadge, Table } from "@/design-system";

export const dynamic = "force-dynamic";

interface Control {
  title: string;
  body: string;
  link?: { href: string; label: string };
}

const CONTROLS: Control[] = [
  { title: "Role-based access", body: "Admin routes require an explicit admin role. Everyone else gets HTTP 403 from every /admin endpoint and a plain not-authorized page." },
  { title: "Append-only audit trail", body: "Suspensions, role changes and credit adjustments are logged with actor, IP, user agent, target and metadata. Entries are never edited or deleted.", link: { href: "/admin/audit", label: "Audit log" } },
  { title: "Access revocation", body: "Suspending blocks access and halts new runs at once; demoting an admin revokes access on the next request. Both are audited.", link: { href: "/admin/users", label: "Users" } },
  { title: "Encryption at rest", body: "Data lives in managed Postgres with encryption at rest. Provider secrets come from environment config and a managed secret store, never source." },
  { title: "Authentication and sessions", body: "Clerk handles sign-in and sessions. Every backend request carries a short-lived JWT verified server-side; the proxy attaches it so browser code never holds long-lived credentials." },
  { title: "Data export and erasure", body: "Admins action per-account export and erasure requests against a user record; each action lands in the audit trail.", link: { href: "/admin/users", label: "Find a user" } },
];

export default function AdminSecurityPage() {
  return (
    <AdminFrame crumbs={[{ label: "Security" }]}>
      <Table<Control>
        rows={CONTROLS}
        rowKey={(c) => c.title}
        columns={[
          {
            key: "control",
            label: "Control",
            render: (c) => (
              <div className="py-2">
                <div className="font-medium">{c.title}</div>
                <div className="mt-0.5 max-w-[640px] text-[12.5px] leading-relaxed text-fg-muted">{c.body}</div>
              </div>
            ),
          },
          { key: "status", label: "Status", hideOnPhone: true, width: "120px", render: () => <StatusBadge tone="positive">Implemented</StatusBadge> },
          {
            key: "link",
            label: <span className="sr-only">Open</span>,
            align: "right",
            width: "120px",
            render: (c) =>
              c.link ? (
                <ButtonLink href={c.link.href} size="sm" variant="ghost">
                  {c.link.label}
                </ButtonLink>
              ) : null,
          },
        ]}
      />
      <p className="text-[12px] text-fg-faint">An engineering reference for controls in the product today, not a compliance attestation.</p>
    </AdminFrame>
  );
}

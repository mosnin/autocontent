import * as React from "react";
import Link from "next/link";
import {
  Ban,
  KeyRound,
  Lock,
  ScrollText,
  ShieldCheck,
  UserCog,
} from "lucide-react";

import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

type Category = "green" | "orange" | "blue" | "purple" | "navy";

interface Control {
  icon: React.ReactNode;
  color: Category;
  title: string;
  body: string;
  link?: { href: string; label: string };
}

const CONTROLS: Control[] = [
  {
    icon: <ShieldCheck />,
    color: "navy",
    title: "Role-based access control",
    body: "Administrative routes are gated on an explicit admin role and follow least-privilege — a non-admin caller receives HTTP 403 from every /admin endpoint, and the admin UI reveals nothing behind a clean 'not authorized' state.",
  },
  {
    icon: <ScrollText />,
    color: "blue",
    title: "Append-only audit trail",
    body: "Every privileged action — suspensions, role changes, credit adjustments — is written to an append-only log capturing the actor, their IP and user agent, the target, and structured metadata. Entries are never mutated or deleted.",
    link: { href: "/admin/audit", label: "Open audit log" },
  },
  {
    icon: <Ban />,
    color: "orange",
    title: "Access revocation",
    body: "Suspending an account immediately blocks access and halts new pipeline runs; demoting an admin revokes privileged access on the next request. Both actions take effect without a deploy and are fully audited.",
    link: { href: "/admin/users", label: "Manage users" },
  },
  {
    icon: <Lock />,
    color: "green",
    title: "Encryption at rest",
    body: "Application data lives in a managed Postgres database with encryption at rest. Provider secrets and API keys are supplied through environment configuration and a managed secret store — never committed to source.",
  },
  {
    icon: <KeyRound />,
    color: "purple",
    title: "Authentication & session controls",
    body: "Authentication and session lifecycle are handled by Clerk. Every backend request carries a short-lived JWT that is verified server-side before any data is returned; the Next.js proxy attaches it so browser code never handles long-lived credentials.",
  },
  {
    icon: <UserCog />,
    color: "navy",
    title: "Data export & erasure",
    body: "Per-account data export and right-to-erasure requests are actioned by administrators against a specific user record, with the resulting action captured in the audit trail for evidence.",
    link: { href: "/admin/users", label: "Find a user" },
  },
];

export default function AdminSecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">
          SOC 2-aligned controls implemented in the platform today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {CONTROLS.map((c) => (
          <Card key={c.title} className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <AppIcon color={c.color}>{c.icon}</AppIcon>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                </div>
                <Badge variant="success" className="shrink-0 font-mono lowercase">
                  implemented
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <CardDescription className="leading-relaxed">
                {c.body}
              </CardDescription>
              {c.link && (
                <Link
                  href={c.link.href}
                  className="mt-auto text-sm font-medium text-brand hover:underline"
                >
                  {c.link.label} →
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/60 bg-muted/30">
        <CardContent className="py-4 text-xs text-muted-foreground">
          This page summarizes controls as implemented in the product. It is an
          engineering reference, not a compliance attestation or a substitute
          for a completed SOC 2 report.
        </CardContent>
      </Card>
    </div>
  );
}

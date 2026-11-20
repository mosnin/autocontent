import { StatusBadge } from "@/design-system";
import type { AdminUser, UserRole } from "@/lib/admin-types";

export function RoleBadge({ role }: { role: UserRole }) {
  return <StatusBadge tone={role === "admin" ? "accent" : "neutral"}>{role === "admin" ? "Admin" : "User"}</StatusBadge>;
}

export function AccountStatusBadge({ user }: { user: AdminUser }) {
  return user.suspended_at ? <StatusBadge tone="negative">Suspended</StatusBadge> : <StatusBadge tone="positive">Active</StatusBadge>;
}

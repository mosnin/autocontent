import { Badge } from "@/components/square/ui/badge";
import type { AdminUser, UserRole } from "@/lib/admin-types";

/** Role chip — admins get the warm-accent outline treatment. */
export function RoleBadge({ role }: { role: UserRole }) {
  if (role === "admin") {
    return (
      <Badge
        variant="outline"
        className="border-brand/50 font-mono lowercase text-brand"
      >
        admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="font-mono lowercase">
      user
    </Badge>
  );
}

/** Account status chip: Active vs Suspended. Same tonal technique as the
 * template's StatusBadge helpers (square/campaigns-table.tsx etc.):
 * `Badge variant="outline"` plus a tonal bg/text/border class, since the
 * square/ui Badge has no built-in success variant. */
export function AccountStatusBadge({ user }: { user: AdminUser }) {
  if (user.suspended_at) {
    return (
      <Badge variant="destructive" className="font-mono lowercase">
        suspended
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="font-mono lowercase bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900"
    >
      active
    </Badge>
  );
}

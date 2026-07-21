import { Badge } from "@/components/ui/badge";
import type { AdminUser, UserRole } from "@/lib/admin-types";

/** Role chip — admins get the warm-accent shield treatment. */
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

/** Account status chip: Active vs Suspended. */
export function AccountStatusBadge({ user }: { user: AdminUser }) {
  if (user.suspended_at) {
    return (
      <Badge variant="destructive" className="font-mono lowercase">
        suspended
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="font-mono lowercase">
      active
    </Badge>
  );
}

import { fetchAdminUsers } from "@/lib/admin-server";
import { UsersClient, PAGE_SIZE } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const initial = await fetchAdminUsers({ limit: PAGE_SIZE, offset: 0 });
  return <UsersClient initial={initial} />;
}

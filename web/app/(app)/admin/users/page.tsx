import { fetchAdminUsers } from "@/lib/admin-server";
import { UsersClient, FETCH_LIMIT } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  // Fetch the same probe-row limit the client uses so the "Next" affordance
  // is correct on the very first server render (no post-hydration flicker).
  const initial = await fetchAdminUsers({ limit: FETCH_LIMIT, offset: 0 });
  return <UsersClient initial={initial} />;
}

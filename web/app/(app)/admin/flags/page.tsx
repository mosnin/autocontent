import { fetchAdminFlags } from "@/lib/admin-server";
import { FlagsClient } from "./FlagsClient";

export const dynamic = "force-dynamic";

export default async function AdminFlagsPage() {
  const initial = await fetchAdminFlags();
  return <FlagsClient initial={initial} />;
}

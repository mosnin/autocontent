import { api } from "@/lib/api";
import { IntegrationsClient } from "./IntegrationsClient";
import type { IntegrationsStatus } from "./types";

export const dynamic = "force-dynamic";

const INTEGRATIONS_PATH = "/api/v1/admin/integrations";

export default async function AdminIntegrationsPage() {
  const initial = await api<IntegrationsStatus>(INTEGRATIONS_PATH);
  return <IntegrationsClient initial={initial} />;
}

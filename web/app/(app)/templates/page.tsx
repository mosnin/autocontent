import { api } from "@/lib/api";
import { TemplatesClient, type Template } from "./TemplatesClient";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const templates = await api<Template[]>("/api/v1/templates");
  return <TemplatesClient initial={templates} />;
}

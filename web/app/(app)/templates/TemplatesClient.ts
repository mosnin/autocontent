// Type-only shim: the /templates route moved to /content?tab=templates.
// app/(app)/admin/templates/AdminTemplatesClient.tsx still imports the
// Template type from here; point it at "@/components/mk/content/types" and
// delete this file (and the folder).
export type { Template } from "@/components/mk/content/types";

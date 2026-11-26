import { PageSkeleton } from "@/design-system";

export default function Loading() {
  return <PageSkeleton template="chat" title="Session" crumbs={[{ label: "Chat", href: "/home" }, { label: "Session" }]} />;
}

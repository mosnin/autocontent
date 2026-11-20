import { ButtonLink, EmptyLine } from "@/design-system";
import { AdminFrame } from "./admin-frame";

/** An admin page whose fetch failed: the frame, and one line saying so. Never a blank screen or a thrown error. */
export function AdminUnavailable({ title, what }: { title?: string; what: string }) {
  return (
    <AdminFrame crumbs={title ? [{ label: title }] : []}>
      <EmptyLine action={<ButtonLink href={title ? "/admin" : "/home"}>{title ? "Back to overview" : "Go home"}</ButtonLink>}>Couldn&apos;t load {what}. The admin API didn&apos;t answer; refresh in a moment.</EmptyLine>
    </AdminFrame>
  );
}

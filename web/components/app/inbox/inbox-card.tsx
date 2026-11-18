"use client";

import { Clapperboard, GalleryHorizontal, Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { ApprovalCard } from "@/design-system";
import { formatRelative } from "@/lib/format";
import { hrefFor, type InboxItem, type InboxKind } from "@/lib/workspace";

const ICON: Record<InboxKind, React.ReactNode> = {
  video: <Clapperboard className="size-3.5 text-on-fill" />,
  carousel: <GalleryHorizontal className="size-3.5 text-on-fill" />,
  ad_change: <Megaphone className="size-3.5 text-on-fill" />,
};
export const INBOX_KIND: Record<InboxKind, string> = { video: "Video", carousel: "Carousel", ad_change: "Ad change" };
const ON_APPROVE: Record<InboxKind, string> = {
  video: "Post it on the playbook's schedule",
  carousel: "Post the carousel",
  ad_change: "Apply the change in the ad account",
};

/** One inbox item as the design system's approval card: what it is, what approving does, where to edit it. */
export function InboxCard({ item, focused }: { item: InboxItem; focused?: boolean }) {
  const router = useRouter();
  return (
    <ApprovalCard
      id={`inbox-${item.id}`}
      item={item}
      focused={focused}
      title={item.title}
      icon={ICON[item.kind]}
      meta={<span suppressHydrationWarning>{`${INBOX_KIND[item.kind]} · ${formatRelative(item.created_at)}`}</span>}
      steps={[{ label: item.detail || INBOX_KIND[item.kind] }, { label: ON_APPROVE[item.kind] }]}
      onEdit={() => router.push(hrefFor(item.kind, item.ref_id))}
    />
  );
}

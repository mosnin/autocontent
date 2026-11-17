"use client";

import { Clapperboard, GalleryHorizontal, Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx, PlanCard } from "@/design-system";
import { formatRelative } from "@/lib/format";
import { hrefFor, type InboxItem, type InboxKind } from "@/lib/workspace";
import { decideInboxItem } from "./decide";

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

/** One thing waiting on a person, as a plan card: Dismiss / Edit / Approve & Run. */
export function InboxPlanCard({ item, focused }: { item: InboxItem; focused?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const decide = async (d: "approve" | "reject") => {
    setBusy(d);
    setError(null);
    try {
      await decideInboxItem(item, d);
      setDone(d);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} id={`inbox-${item.id}`} className={cx("rounded-ds-lg", focused && "ring-1 ring-ds-accent")}>
      <PlanCard
        title={item.title}
        icon={ICON[item.kind]}
        meta={<span suppressHydrationWarning>{`${INBOX_KIND[item.kind]} · ${formatRelative(item.created_at)}`}</span>}
        steps={[{ label: item.detail || INBOX_KIND[item.kind] }, { label: ON_APPROVE[item.kind] }]}
        onDismiss={() => void decide("reject")}
        onEdit={() => router.push(hrefFor(item.kind, item.ref_id))}
        onApprove={() => void decide("approve")}
        approving={busy !== null}
        decided={done ? (done === "approve" ? "Approved" : "Dismissed") : undefined}
      />
      {error && (
        <p role="alert" className="px-1 pt-1.5 text-[12px] text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

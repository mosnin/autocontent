"use client";

import { Clapperboard, GalleryHorizontal, Megaphone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatRelative } from "@/lib/format";
import { hrefFor, type InboxItem } from "@/lib/workspace";
import { Button, cx, Dot, IconTile } from "../ui";

const ICON = { video: <Clapperboard />, carousel: <GalleryHorizontal />, ad_change: <Megaphone /> };
const KIND = { video: "Video", carousel: "Carousel", ad_change: "Ad change" };

export async function decideInboxItem(item: Pick<InboxItem, "kind" | "ref_id">, decision: "approve" | "reject") {
  const res = await fetch(`/api/proxy/api/v1/workspace/inbox/${item.kind}/${encodeURIComponent(item.ref_id)}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(res.status === 409 ? "Already decided." : body.slice(0, 160) || `Failed (${res.status})`);
  }
}

/** One thing that needs a person: what it is, why, and approve/reject in place. */
export function InboxRow({ item, compact, focused }: { item: InboxItem; compact?: boolean; focused?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-300", focused && "bg-accent/[0.06]", done && "opacity-60")}>
      {compact ? <Dot tone="warn" /> : <IconTile>{ICON[item.kind]}</IconTile>}
      <Link href={hrefFor(item.kind, item.ref_id)} className="min-w-0 flex-1 basis-[180px]">
        <div className="truncate text-[14px] font-medium">{item.title}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {!compact && <span>{KIND[item.kind]} · </span>}
          {item.detail}
          {!compact && <span className="text-faint"> · {formatRelative(item.created_at)}</span>}
        </div>
        {error && <div className="text-[12px] text-destructive">{error}</div>}
      </Link>
      {done ? (
        <span className="text-[13px] text-muted-foreground">{done === "approve" ? "Approved" : "Rejected"}</span>
      ) : (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void decide("reject")} disabled={busy !== null} loading={busy === "reject"}>
            {compact ? "No" : "Reject"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void decide("approve")} disabled={busy !== null} loading={busy === "approve"}>
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}

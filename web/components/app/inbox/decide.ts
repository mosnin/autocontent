import type { InboxItem } from "@/lib/workspace";

/** Approve or reject one inbox item (videos, carousels, ad changes). */
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

import { toast } from "sonner";

/**
 * Pull the human `detail` message out of a `"<status> <json-body>"` error
 * string produced by the API clients (`lib/api.ts` / server actions);
 * null when the body isn't that shape.
 */
export function extractDetail(raw: string): string | null {
  const body = raw.replace(/^\d{3}\s*/, "");
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    return typeof parsed.detail === "string" ? parsed.detail : null;
  } catch {
    return null;
  }
}

/** True when an action error string is an out-of-credit refusal (402). */
export function isCreditError(raw: string | undefined | null): raw is string {
  return !!raw && raw.startsWith("402");
}

/**
 * Toast an action failure like a human: a 402 renders the server's
 * human-written detail with an "Add credit" action; anything else falls
 * back to the raw message (better than silence until every route speaks
 * human).
 */
export function toastActionError(raw: string | undefined, fallback: string): void {
  if (isCreditError(raw)) {
    toast.error(extractDetail(raw) ?? "You're out of credit.", {
      action: {
        label: "Add credit",
        onClick: () => {
          window.location.href = "/settings/billing";
        },
      },
    });
    return;
  }
  toast.error(raw ?? fallback);
}

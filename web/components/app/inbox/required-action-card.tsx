"use client";

import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, cx, Facts, Notice, Time, usePending } from "@/design-system";
import { titleCase } from "@/lib/format";
import { type RequiredAction, requiredActionFocusId, type RequiredActionResolution, requiredActionTarget, resolveRequiredAction } from "@/lib/workspace";

/** "content.post.send" → "Send a post": the attempt in plain words. Unknown actions fall back to their own words. */
const ATTEMPT: Record<string, string> = {
  "content.post.send": "Send a post to the channel",
  "content.carousel.approve": "Send a carousel for posting",
  "ads.budget.change": "Change a daily budget on the ad platform",
  "ads.campaign.activate": "Activate an ad campaign",
  "ads.approval.execute": "Apply an approved ad change",
  "campaigns.start": "Start a campaign",
};
export const describeAttempt = (action: string) => ATTEMPT[action] ?? titleCase(action.replace(/\./g, " "));

const WHO: Record<string, string> = { system: "The schedule", agent: "Marketer", user: "You" };

const DONE: Record<RequiredActionResolution, string> = {
  confirmed_succeeded: "Recorded: it happened. New work on this is unblocked.",
  confirmed_failed: "Recorded: it didn't happen. You can run it again.",
};

/**
 * A side effect whose outcome is unknown (docs/rails/required-actions.md):
 * what was attempted, on what, when, and what to check, then the person says
 * whether it happened. Only a person resolves; nothing retries on its own.
 */
export function RequiredActionCard({ action, focused }: { action: RequiredAction; focused?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const { busy, error, run } = usePending<RequiredActionResolution>();
  const [done, setDone] = useState<RequiredActionResolution | null>(null);
  const target = requiredActionTarget(action);
  const allowed = (r: RequiredActionResolution) => action.resolutions.includes(r);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const resolve = (r: RequiredActionResolution) =>
    void run(r, async () => {
      await resolveRequiredAction(action.id, r);
      setDone(r);
      router.refresh();
    });

  return (
    <div ref={ref} id={`inbox-${requiredActionFocusId(action.id)}`} className={cx("ds-enter rounded-ds-lg border bg-surface", focused ? "border-ds-accent" : "border-attention/35")}>
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <CircleHelp aria-hidden className="mt-[3px] size-4 shrink-0 text-attention" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-medium">{action.title}</h3>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">{action.detail}</p>
        </div>
      </div>
      <div className="border-t border-hairline px-3 py-2.5">
        <Facts
          items={[
            { label: "Attempted", value: describeAttempt(action.action) },
            {
              label: "On",
              value: target.href ? (
                <Link href={target.href} className="text-ds-accent hover:underline">
                  {target.label} <span className="font-mono text-[12px]">{action.target_id.slice(0, 8)}</span>
                </Link>
              ) : (
                <>
                  {target.label} {action.target_id && <span className="font-mono text-[12px]">{action.target_id.slice(0, 8)}</span>}
                </>
              ),
            },
            { label: "When", value: <Time iso={action.created_at} mode="datetime" /> },
            { label: "Started by", value: WHO[action.principal] ?? titleCase(action.principal) },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-3 py-2">
        {done ? (
          <Notice ok={DONE[done]} />
        ) : (
          <>
            <span className="min-w-0 flex-1 basis-48 text-[12.5px] text-fg-muted">Resolve: check the platform, then say what happened.</span>
            <span className="flex gap-1.5">
              {allowed("confirmed_failed") && (
                <Button size="sm" onClick={() => resolve("confirmed_failed")} loading={busy === "confirmed_failed"} disabled={busy !== null}>
                  It didn&apos;t happen
                </Button>
              )}
              {allowed("confirmed_succeeded") && (
                <Button size="sm" variant="primary" onClick={() => resolve("confirmed_succeeded")} loading={busy === "confirmed_succeeded"} disabled={busy !== null}>
                  It happened
                </Button>
              )}
            </span>
          </>
        )}
      </div>
      {error && (
        <div className="border-t border-hairline px-3 py-2">
          <Notice error={error} />
        </div>
      )}
    </div>
  );
}

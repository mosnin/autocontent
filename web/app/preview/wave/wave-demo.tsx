"use client";

import { Megaphone, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Button, CommitWave, Facts, StatusBadge, StepMark, ToolIcon } from "@/design-system";

function Launch() {
  const [live, setLive] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <CommitWave
      moment="launch"
      tone="b"
      committed={live}
      source={btn}
      className="w-full max-w-[520px] border border-hairline"
      action={
        <div className="flex h-full items-end justify-end p-4">
          {live ? (
            <Button variant="ghost" onClick={() => setLive(false)} data-testid="reset">
              Back
            </Button>
          ) : (
            <Button ref={btn} variant="primary" onClick={() => setLive(true)} data-testid="launch">
              Launch campaign
            </Button>
          )}
        </div>
      }
      receipt={
        <div className="min-h-[300px] p-5">
          <div className="flex items-center gap-2.5">
            <ToolIcon tone="b" size={22}>
              <Megaphone />
            </ToolIcon>
            <h2 className="text-[15px] font-medium">Fresh pasta, Spring is live</h2>
            <StatusBadge tone="positive">Live</StatusBadge>
          </div>
          <p className="mt-2 text-[13px] text-fg-muted">Spending up to $40 a day on Meta. First numbers arrive in about an hour.</p>
        </div>
      }
    >
      <div className="min-h-[300px] p-5">
        <div className="flex items-center gap-2.5">
          <ToolIcon tone="b" size={22}>
            <Megaphone />
          </ToolIcon>
          <h2 className="text-[15px] font-medium">Review: Fresh pasta, Spring</h2>
        </div>
        <div className="mt-4">
          <Facts
            items={[
              { label: "Platform", value: "Meta Ads" },
              { label: "Daily budget", value: "$40.00" },
              { label: "Account cap", value: "$60.00 a day" },
              { label: "Starts", value: "Now" },
            ]}
          />
        </div>
      </div>
    </CommitWave>
  );
}

function Approve() {
  const [done, setDone] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <CommitWave
      moment="approve"
      committed={done}
      source={btn}
      className="w-full max-w-[520px] border border-hairline"
      action={
        <div className="flex h-full items-end justify-end gap-1.5 p-3">
          {done ? (
            <Button size="sm" variant="ghost" onClick={() => setDone(false)}>
              Back
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost">
                Dismiss
              </Button>
              <Button ref={btn} size="sm" variant="primary" onClick={() => setDone(true)} data-testid="approve">
                Approve & Run
              </Button>
            </>
          )}
        </div>
      }
      receipt={
        <div className="min-h-[170px] p-4">
          <div className="flex items-center gap-2.5 text-[13.5px] font-medium">
            <StepMark state="done" /> Approved. Media buyer is moving the budget.
          </div>
          <p className="mt-2 text-[12.5px] text-fg-muted">$40 a day from the spring ad set to the Spark ad.</p>
        </div>
      }
    >
      <div className="min-h-[170px] p-4">
        <div className="flex items-center gap-2.5 text-[13.5px] font-medium">
          <ShieldCheck className="size-4 text-attention" /> Change ad budget
        </div>
        <ol className="mt-3 space-y-2 text-[12.5px] text-fg-muted">
          <li className="flex gap-2.5">
            <StepMark state="todo" /> Move $40 a day from the spring ad set
          </li>
          <li className="flex gap-2.5">
            <StepMark state="todo" /> To the Spark ad on “3 pasta mistakes”
          </li>
        </ol>
      </div>
    </CommitWave>
  );
}

export function WaveDemo() {
  return (
    <div className="mx-auto max-w-[520px] space-y-8">
      <section>
        <h1 className="mb-3 text-[13px] text-fg-muted">launch</h1>
        <Launch />
      </section>
      <section>
        <h1 className="mb-3 text-[13px] text-fg-muted">approve</h1>
        <Approve />
      </section>
    </div>
  );
}

"use client";

import { Megaphone, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { AgentSplit, Button, CommitWave, Facts, PlanCard, StatusBadge, ToolIcon, WorkspaceLogo } from "@/design-system";

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

/** The real plan card: `approved` turns on its approve wave. */
function Approve() {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-2">
      <PlanCard
        title="Change ad budget"
        icon={<ShieldCheck className="size-4 text-on-fill" />}
        meta={<StatusBadge>Media buyer · medium risk</StatusBadge>}
        steps={[{ label: "Move $40 a day from the spring ad set" }, { label: "To the Spark ad on “3 pasta mistakes”" }]}
        onDismiss={() => undefined}
        onApprove={() => setDone(true)}
        decided={done ? "Approved" : undefined}
        approved={done}
      />
    </div>
  );
}

function Arrive() {
  const [there, setThere] = useState(false);
  const mark = useRef<HTMLSpanElement>(null);
  return (
    <div className="space-y-2">
      <CommitWave
        moment="arrive"
        committed={there}
        source={mark}
        className="border border-hairline"
        receipt={
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
            <WorkspaceLogo name="Fresh Pasta Co" size={44} />
            <div className="text-[17px] font-medium">Fresh Pasta Co is set up</div>
            <p className="text-[13px] text-fg-muted">Opening your first video.</p>
          </div>
        }
      >
        <div className="min-h-[220px] p-5">
          <span ref={mark} className="inline-flex">
            <WorkspaceLogo name="Fresh Pasta Co" size={36} />
          </span>
          <p className="mt-3 text-[13px] text-fg-muted">The workspace preview, taking shape during onboarding.</p>
        </div>
      </CommitWave>
      <Button size="sm" onClick={() => setThere((v) => !v)} data-testid="arrive">
        {there ? "Back" : "Review my first video"}
      </Button>
    </div>
  );
}

const TEAM = [
  { name: "Content producer", tone: "a" as const },
  { name: "Media buyer", tone: "b" as const },
  { name: "Analyst", tone: "e" as const },
];

function Split() {
  const [n, setN] = useState(0);
  const [working, setWorking] = useState(true);
  return (
    <div className="rounded-ds-lg border border-hairline bg-ds-bg p-5">
      <div className="min-h-[64px]">
        <AgentSplit agents={TEAM.slice(0, n)} working={working} activeName="Media buyer" />
      </div>
      <div className="mt-4 flex gap-1.5">
        <Button size="sm" onClick={() => (setWorking(true), setN((v) => Math.min(3, v + 1)))} data-testid="split">
          Hand off
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setWorking(false)} data-testid="merge">
          Done
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setN(0), setWorking(true))}>
          Reset
        </Button>
      </div>
    </div>
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
      <section>
        <h1 className="mb-3 text-[13px] text-fg-muted">arrive</h1>
        <Arrive />
      </section>
      <section>
        <h1 className="mb-3 text-[13px] text-fg-muted">agent split (goo)</h1>
        <Split />
      </section>
    </div>
  );
}

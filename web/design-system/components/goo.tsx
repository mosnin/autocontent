"use client";

/**
 * AgentSplit: one Marketer, many specialists.
 *
 * When Marketer hands work to its specialists, their chips bud out of the
 * Marketer chip like droplets from one body, and melt back into it when the
 * work is done. The liquid says what the product is: one marketing department
 * that splits into the people a job needs (see ../GOO.md).
 *
 * This is the only use of the goo effect. Never import `liquid-gooey` anywhere
 * else, and never use it for decoration.
 */
import { Liquid } from "liquid-gooey";
import { useEffect, useState } from "react";
import { cx } from "../cx";
import { AgentGlyph, type ToolTone } from "./primitives";

export interface SplitAgent {
  name: string;
  tone?: ToolTone;
}

const PILL = "flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px]";
/** How far left a chip starts, so it reads as leaving the lead chip rather than appearing in place. */
const STEP = 84;

function Bud({ agent, index, out, active, onSelect }: { agent: SplitAgent; index: number; out: boolean; active: boolean; onSelect?: (name: string) => void }) {
  // A chip mounts tucked into the lead, then moves out on the next frame.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = ready && out;
  return (
    <Liquid.Item x={shown ? 0 : -(index + 1) * STEP} transition="bouncy" delay={index * 45}>
      <button
        type="button"
        onClick={() => onSelect?.(agent.name)}
        aria-pressed={active}
        tabIndex={shown ? 0 : -1}
        className={cx(PILL, "transition-opacity", shown ? "opacity-100 delay-150 duration-200" : "opacity-0 duration-75", active ? "text-fg" : "text-fg-muted hover:text-fg")}
      >
        <AgentGlyph size={14} tone={agent.tone} />
        {agent.name}
      </button>
    </Liquid.Item>
  );
}

export function AgentSplit({
  lead = "Marketer",
  agents,
  working,
  activeName,
  onSelect,
  label = "Agent is working",
  className,
}: {
  /** The one body the specialists come from. */
  lead?: string;
  /** The specialists on this job, in the order they joined. */
  agents: SplitAgent[];
  /** true while work is in progress: chips are out. false: they melt back into the lead. */
  working: boolean;
  activeName?: string;
  onSelect?: (name: string) => void;
  label?: string;
  className?: string;
}) {
  // Stay mounted just long enough for the chips to melt back, then leave: a finished job shows no team.
  const [present, setPresent] = useState(working);
  useEffect(() => {
    if (working) return setPresent(true);
    const id = setTimeout(() => setPresent(false), 700);
    return () => clearTimeout(id);
  }, [working]);
  if (agents.length === 0 || !present) return null;
  return (
    <div className={className}>
      <div className="mb-2 text-[12px] text-fg-faint">{label}</div>
      <Liquid blur={5} contrast={18} fill="hsl(var(--ds-surface-3))" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Liquid.Item>
          <span className={cx(PILL, "font-medium text-fg")}>
            <AgentGlyph size={14} />
            {lead}
          </span>
        </Liquid.Item>
        {agents.map((a, i) => (
          <Bud key={a.name} agent={a} index={i} out={working} active={activeName === a.name} onSelect={onSelect} />
        ))}
      </Liquid>
    </div>
  );
}

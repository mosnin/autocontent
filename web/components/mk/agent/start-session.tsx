"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { departmentById, type DepartmentId } from "@/lib/departments";
import { useAgent } from "@/components/chat/agent-provider";
import { Composer } from "./composer";
import { queueFirstMessage } from "./conversation";
import { cx } from "../ui";

/**
 * A composer that opens a new session: mints a conversation on the agent
 * harness, queues the first message, and navigates there. Used on Home,
 * New session and every department page ("Ask the …").
 */
export function StartSession({
  scope: initialScope = null,
  suggestions = [],
  autoStart,
  className,
  lockScope,
  autoFocus,
}: {
  scope?: DepartmentId | null;
  suggestions?: string[];
  /** Start immediately with this text (from ⌘K or a deep link). */
  autoStart?: string;
  className?: string;
  lockScope?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const { state, threads } = useAgent();
  const [scope, setScope] = useState<DepartmentId | null>(initialScope);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auto = useRef(false);

  const start = async (text: string, s: DepartmentId | null) => {
    if (state.status === "offline") {
      router.push(`/sessions/new?q=${encodeURIComponent(text)}${s ? `&dept=${s}` : ""}`);
      return;
    }
    if (!threads) return;
    setStarting(true);
    setError(null);
    try {
      const id = await threads.create({ title: text.slice(0, 72) });
      queueFirstMessage(id, text, s);
      router.push(`/sessions/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a session");
      setStarting(false);
    }
  };

  useEffect(() => {
    if (autoStart && threads && !auto.current) {
      auto.current = true;
      void start(autoStart, initialScope);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, threads]);

  const dept = departmentById(scope);
  return (
    <div className={className}>
      <Composer onSubmit={(t, s) => void start(t, s)} scope={scope} onScopeChange={lockScope ? undefined : setScope} busy={starting} disabled={starting || state.status === "loading"} autoFocus={autoFocus} placeholder={dept?.placeholder} />
      {error && <p className="mt-2 text-[13px] text-destructive">{error}</p>}
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" disabled={starting} onClick={() => void start(s, scope)} className={cx("press h-8 max-w-full truncate rounded-full border border-border bg-card px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50")}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

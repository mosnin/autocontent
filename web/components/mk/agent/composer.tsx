"use client";

import { ArrowUp, Check, ChevronDown, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEPARTMENTS, departmentById, MARKETER, type DepartmentId } from "@/lib/departments";
import { AgentAvatar, cx } from "../ui";

/**
 * The one composer (Home, sessions, department pages): a soft card with the
 * input, a scope picker ("Marketer routes each request" or one department),
 * and the round send button. Enter sends, Shift+Enter breaks a line.
 */
export function Composer({
  onSubmit,
  scope,
  onScopeChange,
  placeholder,
  autoFocus,
  busy,
  onStop,
  disabled,
  initialValue,
  className,
}: {
  onSubmit: (text: string, scope: DepartmentId | null) => void;
  scope?: DepartmentId | null;
  onScopeChange?: (scope: DepartmentId | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  initialValue?: string;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dept = departmentById(scope ?? null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(240, Math.max(52, el.scrollHeight))}px`;
  }, [value]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || busy) return;
    onSubmit(text, scope ?? null);
    setValue("");
  };

  return (
    <div className={cx("rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)] transition-[border-color,box-shadow] duration-150 focus-within:border-border-strong", className)}>
      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder ?? dept?.placeholder ?? "Ask Marketer to plan, make, post or scale…"}
        aria-label="Message Marketer"
        rows={2}
        disabled={disabled}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-faint disabled:opacity-60"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
        {onScopeChange ? (
          <div ref={menuRef} className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="listbox" aria-expanded={menu} className="press flex h-8 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
              <AgentAvatar name={dept?.agentName ?? MARKETER.name} palette={dept?.palette ?? MARKETER.palette} size={22} />
              <span className="font-medium text-foreground">{dept?.agentName ?? MARKETER.name}</span>
              <span className="hidden text-faint sm:inline">{dept ? dept.label : "Routes each request"}</span>
              <ChevronDown className="size-3.5" />
            </button>
            {menu && (
              <div role="listbox" className="t-pop absolute bottom-full left-0 z-30 mb-2 w-[280px] rounded-[14px] border border-border bg-card p-1 shadow-float" style={{ ["--origin" as string]: "bottom left" }}>
                {[null, ...DEPARTMENTS.map((d) => d.id)].map((id) => {
                  const d = departmentById(id);
                  const selected = (scope ?? null) === id;
                  return (
                    <button
                      key={id ?? "marketer"}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => (onScopeChange(id), setMenu(false), ref.current?.focus())}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                    >
                      <AgentAvatar name={d?.agentName ?? MARKETER.name} palette={d?.palette ?? MARKETER.palette} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{d?.agentName ?? MARKETER.name}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">{d ? d.label : "Orchestrator, routes each request"}</span>
                      </span>
                      {selected && <Check className="size-4 text-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1.5 pl-1 text-[13px] text-muted-foreground">
            <AgentAvatar name={dept?.agentName ?? MARKETER.name} palette={dept?.palette ?? MARKETER.palette} size={22} />
            {dept?.agentName ?? MARKETER.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[12px] text-faint sm:inline">Shift + Enter for a new line</span>
          {busy && onStop ? (
            <button type="button" onClick={onStop} className="press flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Stop" title="Stop">
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!value.trim() || disabled} className="press flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-faint" aria-label="Send" title="Send">
              <ArrowUp className="size-4" strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

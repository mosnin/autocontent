"use client";

import { ChevronDown } from "lucide-react";
import { AgentGlyph, MenuButton, MenuItem } from "@/design-system";
import { DEPARTMENTS, departmentById, type DepartmentId } from "@/lib/departments";
import { TOOL_ICON } from "../shell/sidebar";

/** "◎ Marketer · Routes each request ⌄" (ref 02 composer strip): who answers. */
export function AgentPicker({ value, onChange, locked }: { value: DepartmentId | null; onChange: (v: DepartmentId | null) => void; locked?: boolean }) {
  const d = departmentById(value);
  const label = (
    <span className="flex items-center gap-2">
      <AgentGlyph size={14} tone={d ? TOOL_ICON[d.id].tone : undefined} />
      <span className="font-medium text-fg">{d?.agentName ?? "Marketer"}</span>
      <span className="text-fg-faint">{d ? d.label : "Routes each request"}</span>
    </span>
  );
  if (locked) return label;
  return (
    <MenuButton
      trigger={() => (
        <button type="button" className="flex items-center gap-1 rounded-ds-sm py-0.5 hover:text-fg" aria-haspopup="listbox">
          {label}
          <ChevronDown className="size-3 text-fg-faint" />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem selected={!value} icon={<AgentGlyph size={16} />} hint="Routes each request" onClick={() => (onChange(null), close())}>
            Marketer
          </MenuItem>
          {DEPARTMENTS.map((x) => (
            <MenuItem key={x.id} selected={value === x.id} icon={<AgentGlyph size={16} tone={TOOL_ICON[x.id].tone} />} hint={x.label} onClick={() => (onChange(x.id), close())}>
              {x.agentName}
            </MenuItem>
          ))}
        </>
      )}
    </MenuButton>
  );
}

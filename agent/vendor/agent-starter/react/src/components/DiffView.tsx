import { type CSSProperties, useId, useMemo, useState } from "react";
import { cx } from "../internal/format.ts";

export type DiffLineType = "add" | "del" | "context" | "hunk" | "meta";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffFile {
  /** Path after the change (or before, for deletions). */
  path: string;
  oldPath: string | null;
  newPath: string | null;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

const stripPrefix = (path: string): string | null => (path === "/dev/null" ? null : path.replace(/^[ab]\//, ""));

/**
 * Parse a unified (multi-file) diff — `git diff`, `createTwoFilesPatch` output
 * (e.g. the coding agent's `commit_changes` / `branch_diff` results) — into
 * files with numbered lines. Unknown lines are ignored; never throws.
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  let pendingOld: string | null | undefined;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("diff --git ")) {
      pendingOld = undefined;
      current = null;
      continue;
    }
    if (line.startsWith("Index: ") || line.startsWith("====")) continue;
    if (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
      pendingOld = stripPrefix(line.slice(4).split("\t")[0]?.trim() ?? "");
      continue;
    }
    if (line.startsWith("+++ ") && pendingOld !== undefined) {
      const newPath = stripPrefix(line.slice(4).split("\t")[0]?.trim() ?? "");
      const oldPath = pendingOld;
      pendingOld = undefined;
      current = {
        path: newPath ?? oldPath ?? "(unknown)",
        oldPath,
        newPath,
        status: oldPath === null ? "added" : newPath === null ? "deleted" : oldPath !== newPath ? "renamed" : "modified",
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      current.lines.push({ type: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      current.lines.push({ type: "add", text: line.slice(1), newNumber: newNo++ });
      current.additions++;
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "del", text: line.slice(1), oldNumber: oldNo++ });
      current.deletions++;
    } else if (line.startsWith(" ")) {
      current.lines.push({ type: "context", text: line.slice(1), oldNumber: oldNo++, newNumber: newNo++ });
    } else if (line.startsWith("\\")) {
      current.lines.push({ type: "meta", text: line });
    }
  }
  return files;
}

export interface DiffViewProps {
  /** Unified diff text (multi-file). Ignored when `files` is given. */
  patch?: string;
  /** Pre-parsed files (from `parseUnifiedDiff`). */
  files?: DiffFile[];
  /** Heading above the file list, e.g. "agent/fix-login → main". */
  title?: string;
  /** Start with every file collapsed. Default: collapsed when more than 8 files. */
  collapsed?: boolean;
  /** Lines rendered per file before a "show all" toggle. Default 400. */
  maxLinesPerFile?: number;
  /** Message when the diff is empty. */
  emptyText?: string;
  className?: string;
  style?: CSSProperties;
}

const mono: CSSProperties = { fontFamily: "var(--as-font-mono, ui-monospace, monospace)", fontSize: "12.5px", lineHeight: 1.5 };
const rowTone: Record<DiffLineType, CSSProperties> = {
  add: { background: "var(--as-color-success-soft, #dcfce7)" },
  del: { background: "var(--as-color-danger-soft, #fee2e2)" },
  context: {},
  hunk: { background: "var(--as-color-info-soft, #dbeafe)", color: "var(--as-color-text-muted, #5b6170)" },
  meta: { color: "var(--as-color-text-muted, #5b6170)", fontStyle: "italic" },
};
const marker: Record<DiffLineType, string> = { add: "+", del: "-", context: " ", hunk: "", meta: "" };

function FileDiff({ file, defaultOpen, maxLines }: { file: DiffFile; defaultOpen: boolean; maxLines: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const bodyId = useId();
  const visible = showAll ? file.lines : file.lines.slice(0, maxLines);
  return (
    <section className="as-diff-file" style={{ border: "1px solid var(--as-color-border, #e3e4e8)", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        style={{ all: "unset", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", width: "100%", boxSizing: "border-box", padding: "6px 10px", background: "var(--as-color-surface, #f7f7f8)", ...mono }}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.path}>
          {file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : file.path}
        </span>
        <span className="as-diff-status" data-status={file.status} style={{ color: "var(--as-color-text-muted, #5b6170)" }}>
          {file.status}
        </span>
        <span aria-label={`${file.additions} additions`} style={{ color: "var(--as-color-success, #15803d)" }}>
          +{file.additions}
        </span>
        <span aria-label={`${file.deletions} deletions`} style={{ color: "var(--as-color-danger, #b91c1c)" }}>
          −{file.deletions}
        </span>
      </button>
      {open ? (
        <div id={bodyId} style={{ overflowX: "auto" }}>
          <table aria-label={`Changes in ${file.path}`} style={{ borderCollapse: "collapse", width: "100%", ...mono }}>
            <tbody>
              {visible.map((line, index) => (
                <tr key={index} data-type={line.type} style={rowTone[line.type]}>
                  <td style={{ width: 1, padding: "0 6px", textAlign: "right", color: "var(--as-color-text-muted, #5b6170)", userSelect: "none" }}>{line.oldNumber ?? ""}</td>
                  <td style={{ width: 1, padding: "0 6px", textAlign: "right", color: "var(--as-color-text-muted, #5b6170)", userSelect: "none" }}>{line.newNumber ?? ""}</td>
                  <td style={{ width: 1, padding: "0 4px", userSelect: "none" }} aria-hidden="true">
                    {marker[line.type]}
                  </td>
                  <td style={{ whiteSpace: "pre", padding: "0 8px 0 0" }}>{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {file.lines.length > maxLines && !showAll ? (
            <button type="button" onClick={() => setShowAll(true)} style={{ margin: 8 }}>
              Show all {file.lines.length} lines
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Read-only diff review pane: per-file collapsible sections with +/− counts,
 * old/new line numbers and add/delete highlighting. Diff text is rendered as
 * plain text (never HTML), so repository content cannot inject markup.
 * Pair it with `HumanOversightCard` so approvers see exactly what a
 * `merge_to_main` / `push_branch` / `open_pull_request` would apply.
 */
export function DiffView({ patch, files, title, collapsed, maxLinesPerFile = 400, emptyText = "No changes.", className, style }: DiffViewProps) {
  const parsed = useMemo(() => files ?? parseUnifiedDiff(patch ?? ""), [files, patch]);
  const totals = parsed.reduce((acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }), { additions: 0, deletions: 0 });
  const startOpen = collapsed === undefined ? parsed.length <= 8 : !collapsed;
  return (
    <div className={cx("as-root", "as-diff", className)} style={style} role="region" aria-label={title ?? "Diff"}>
      <header style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
        {title ? <strong style={{ flex: 1 }}>{title}</strong> : <span style={{ flex: 1 }} />}
        <span style={{ color: "var(--as-color-text-muted, #5b6170)" }}>
          {parsed.length} file{parsed.length === 1 ? "" : "s"} · <span style={{ color: "var(--as-color-success, #15803d)" }}>+{totals.additions}</span> <span style={{ color: "var(--as-color-danger, #b91c1c)" }}>−{totals.deletions}</span>
        </span>
      </header>
      {parsed.length === 0 ? <p style={{ color: "var(--as-color-text-muted, #5b6170)" }}>{emptyText}</p> : parsed.map((file) => <FileDiff key={`${file.oldPath}:${file.newPath}`} file={file} defaultOpen={startOpen} maxLines={maxLinesPerFile} />)}
    </div>
  );
}

/** Pull a unified diff out of approval/tool arguments or results (`diff` / `patch` string fields). */
export function diffFromArgs(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["diff", "patch"]) if (typeof record[key] === "string" && /^(---|\+\+\+|@@|diff --git|Index:)/m.test(record[key] as string)) return record[key] as string;
  return null;
}

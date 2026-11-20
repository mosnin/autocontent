import { diffArrays } from "diff";

export interface MergeConflict {
  baseStart: number;
  ours: string[];
  base: string[];
  theirs: string[];
}

export interface MergeResult {
  merged: string;
  conflicts: MergeConflict[];
  clean: boolean;
}

/** Map each base line index to its matching index in `other` (only for unchanged lines). */
function matchMap(base: string[], other: string[]): Map<number, number> {
  const map = new Map<number, number>();
  let b = 0;
  let o = 0;
  for (const change of diffArrays(base, other)) {
    const count = change.count ?? change.value.length;
    if (change.added) o += count;
    else if (change.removed) b += count;
    else {
      for (let i = 0; i < count; i++) map.set(b + i, o + i);
      b += count;
      o += count;
    }
  }
  return map;
}

function equal(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Line-based three-way merge (diff3). Non-overlapping edits from both sides
 * are combined; overlapping, different edits are reported as conflicts (and
 * rendered with git-style markers) rather than silently overwritten.
 */
export function threeWayMerge(baseText: string, oursText: string, theirsText: string, labels = { ours: "ours", theirs: "theirs" }): MergeResult {
  if (oursText === theirsText) return { merged: oursText, conflicts: [], clean: true };
  if (baseText === oursText) return { merged: theirsText, conflicts: [], clean: true };
  if (baseText === theirsText) return { merged: oursText, conflicts: [], clean: true };

  const base = baseText.split("\n");
  const ours = oursText.split("\n");
  const theirs = theirsText.split("\n");
  const toOurs = matchMap(base, ours);
  const toTheirs = matchMap(base, theirs);

  const output: string[] = [];
  const conflicts: MergeConflict[] = [];
  let ib = 0;
  let io = 0;
  let it = 0;

  const resolve = (bEnd: number, oEnd: number, tEnd: number) => {
    const b = base.slice(ib, bEnd);
    const o = ours.slice(io, oEnd);
    const t = theirs.slice(it, tEnd);
    if (b.length === 0 && o.length === 0 && t.length === 0) return;
    if (equal(o, b)) output.push(...t);
    else if (equal(t, b)) output.push(...o);
    else if (equal(o, t)) output.push(...o);
    else {
      conflicts.push({ baseStart: ib + 1, ours: o, base: b, theirs: t });
      output.push(`<<<<<<< ${labels.ours}`, ...o, "=======", ...t, `>>>>>>> ${labels.theirs}`);
    }
  };

  for (let k = 0; k < base.length; k++) {
    const o = toOurs.get(k);
    const t = toTheirs.get(k);
    if (o === undefined || t === undefined || o < io || t < it) continue;
    resolve(k, o, t);
    output.push(base[k] as string);
    ib = k + 1;
    io = o + 1;
    it = t + 1;
  }
  resolve(base.length, ours.length, theirs.length);
  return { merged: output.join("\n"), conflicts, clean: conflicts.length === 0 };
}

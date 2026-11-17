#!/usr/bin/env node
/**
 * Design-system guard. Fails when app code drifts from web/design-system.
 * Rules: see README.md section 6. Run: npm run ds:guard
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const SCOPES = ["app/(app)", "app/(onboarding)", "app/preview/app", "app/preview/onboarding", "components/shell", "components/chat", "components/home", "components/app", "components/onboarding", "design-system"];
const RAW_COLOUR_OK = new Set(["design-system/components/shader.tsx", "design-system/components/surfaces.tsx"]);

const RULES = [
  { id: "hard-colour", re: /\b(?:bg|text|border|from|to|via|fill|stroke|ring|outline|divide|decoration)-(?:white|black)\b(?!\/)/g, why: "use a token (bg-surface, text-fg, bg-ds-primary…), not white/black" },
  { id: "arbitrary-colour", re: /-\[(?:#|rgb|hsl|color:)[^\]]*\]/g, why: "no arbitrary colour values; add a token in tokens.css", skipRaw: true },
  { id: "hex-literal", re: /["'`]#[0-9a-fA-F]{3,8}["'`]/g, why: "no hex colours in components; use tokens", skipRaw: true },
  { id: "old-token", re: /\b(?:bg|text|border|ring|divide|fill|stroke)-(?:muted|muted-foreground|card|card-foreground|border|border-strong|subtle|foreground|background|faint|accent|floor|queued|destructive|live|warn)\b(?![-\w])/g, why: "old .mk-app / shadcn token; use the ds tokens (surface, fg-muted, hairline, ds-accent, positive, attention, negative)" },
  { id: "dark-variant", re: /(?<![\w-])dark:[\w[]/g, why: "no dark: variants; the theme comes from tokens" },
  { id: "radius", re: /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e))?-(?:sm|md|lg|xl|2xl|3xl|\[[^\]]+\])(?![-\w])|\brounded(?=["'`\s])/g, why: "corners are rounded-ds-xs/sm/md/lg/xl, rounded-full or rounded-none" },
  { id: "animated-decoration", re: /\banimate-(?:pulse|ping|bounce)\b/g, why: "nothing decorative moves (no pulsing/pinging dots)" },
  { id: "old-kit", re: /from\s+["'](?:@\/components\/(?:mk|ui|square|podium|hub|charts|reactbits|pixel-perfect)\/|(?:\.\.\/)+(?:mk|ui|square|podium|hub)\/|\.\/(?:mk)\/)[^"']*["']/g, why: "import from @/design-system, not an old kit" },
  { id: "empty-art", re: /\b(?:EmptyArt|empty-art)\b/g, why: "empty states are one EmptyLine, no illustrations" },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "references" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const problems = [];
for (const scope of SCOPES) {
  for (const file of walk(join(root, scope))) {
    const rel = relative(root, file).split(sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/ds-guard-ignore/.test(line)) return;
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      for (const rule of RULES) {
        if (rule.skipRaw && RAW_COLOUR_OK.has(rel)) continue;
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line))) problems.push({ rel, line: i + 1, rule: rule.id, hit: m[0], why: rule.why });
      }
    });
  }
}

if (problems.length === 0) {
  console.log("ds:guard ok: app code follows web/design-system");
  process.exit(0);
}
const byRule = new Map();
for (const p of problems) byRule.set(p.rule, (byRule.get(p.rule) ?? 0) + 1);
for (const p of problems.slice(0, 400)) console.log(`${p.rel}:${p.line}  ${p.rule}  ${p.hit}  (${p.why})`);
if (problems.length > 400) console.log(`… and ${problems.length - 400} more`);
console.log(`\nds:guard failed: ${problems.length} problem(s): ${[...byRule].map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log("See web/design-system/README.md section 6.");
process.exit(1);

import { Fragment, type ReactNode } from "react";

/**
 * A small, safe markdown renderer for agent replies: headings, paragraphs,
 * bullet and numbered lists, block quotes, fenced code, tables, bold, italic,
 * inline code and links. No raw HTML is ever rendered.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className ?? "space-y-2.5 text-[13.5px] leading-[1.6]"}>{blocks(text)}</div>;
}

function inline(src: string, keyBase = ""): ReactNode[] {
  const out: ReactNode[] = [];
  // Links are http(s) or a same-site path. "//host" and "/\\host" are refused:
  // browsers read them as another site, and they would open without rel/target.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+|\/(?![\/\\])[^)\s]*)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    const tok = m[0];
    if (m[1]) out.push(<code key={k} className="rounded-ds-xs bg-surface-3 px-1 py-px font-mono text-[12px]">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (m[4]) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = m[5]!;
      out.push(
        <a key={k} href={href} className="text-ds-accent underline-offset-2 hover:underline" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
          {label}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      out.push(
        <pre key={k++} className="overflow-x-auto rounded-ds-md border border-hairline bg-surface-2 p-3 font-mono text-[12px]">
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      out.push(
        <div key={k++} role="heading" aria-level={level + 1} className={level <= 2 ? "pt-1 text-[15px] font-medium" : "pt-1 text-[13.5px] font-medium"}>
          {inline(h[2]!, `h${k}`)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const row = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(row(lines[i++]!));
      out.push(
        <div key={k++} className="overflow-x-auto rounded-ds-md border border-hairline">
          <table className="w-full text-[13px]">
            <thead className="border-b border-hairline text-left text-[12px] text-fg-faint">
              <tr>{head.map((c, j) => <th key={j} className="px-3 py-2 font-normal">{inline(c)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="px-3 py-2 tabular">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={k++} className={ordered ? "list-decimal space-y-1 pl-5 marker:text-fg-faint" : "list-disc space-y-1 pl-5 marker:text-fg-faint"}>
          {items.map((it, j) => <li key={j}>{inline(it, `li${k}-${j}`)}</li>)}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) body.push(lines[i++]!.replace(/^>\s?/, ""));
      out.push(
        <blockquote key={k++} className="border-l-2 border-hairline-strong pl-3 text-fg-muted">
          {inline(body.join(" "))}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|>|\s*([-*•]|\d+[.)])\s)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(
      <p key={k++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}

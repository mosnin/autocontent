import type { ReactNode } from "react";
import { isSafeUrl } from "./format.ts";

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)|(_[^_\s][^_\n]*_)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      nodes.push(<code key={key} className="as-md-code">{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (match[3]) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        isSafeUrl(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (match[4] || match[5]) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (match[6]) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer">
          {token}
        </a>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderLines(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    nodes.push(...renderInline(line, `${keyPrefix}-${index}`));
  });
  return nodes;
}

type Block =
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" }
  | { kind: "paragraph"; lines: string[] };

const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = /^\s*```\s*([\w.+-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) code.push(lines[index++] ?? "");
      index++;
      blocks.push({ kind: "code", lang: fence[1] ?? "", lines: code });
      continue;
    }
    if (!line.trim()) {
      index++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index++;
      continue;
    }
    const ordered = ORDERED.test(line);
    if (ordered || UNORDERED.test(line)) {
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index] ?? "");
        if (item) {
          items.push(item[1] ?? "");
        } else if ((lines[index] ?? "").trim() && /^\s{2,}/.test(lines[index] ?? "") && items.length) {
          items[items.length - 1] += ` ${(lines[index] ?? "").trim()}`;
        } else {
          break;
        }
        index++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? "")) quote.push((lines[index++] ?? "").replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!current.trim() || /^\s*```/.test(current) || /^#{1,6}\s/.test(current) || /^\s*>/.test(current) || UNORDERED.test(current) || ORDERED.test(current)) break;
      paragraph.push(current);
      index++;
    }
    if (paragraph.length === 0) {
      // Defensive: never stall on a line no block rule consumed.
      paragraph.push(line);
      index++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/**
 * Renders the markdown subset chat models commonly produce — paragraphs,
 * headings, lists, quotes, rules, fenced code, inline code, bold, italics and
 * links (http/https/mailto only) — as React elements. Never uses innerHTML.
 */
export function Markdown({ text }: { text: string }): ReactNode {
  return parseBlocks(text).map((block, index) => {
    const key = `b${index}`;
    switch (block.kind) {
      case "code":
        return (
          <pre key={key} className="as-md-pre" data-lang={block.lang || undefined}>
            <code>{block.lines.join("\n")}</code>
          </pre>
        );
      case "heading": {
        const level = Math.min(6, block.level + 2);
        const Tag = `h${level}` as "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={key} className="as-md-heading">
            {renderInline(block.text, key)}
          </Tag>
        );
      }
      case "list": {
        const items = block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>);
        return block.ordered ? (
          <ol key={key} className="as-md-list">
            {items}
          </ol>
        ) : (
          <ul key={key} className="as-md-list">
            {items}
          </ul>
        );
      }
      case "quote":
        return (
          <blockquote key={key} className="as-md-quote">
            {renderLines(block.lines, key)}
          </blockquote>
        );
      case "rule":
        return <hr key={key} className="as-md-rule" />;
      case "paragraph":
        return (
          <p key={key} className="as-md-p">
            {renderLines(block.lines, key)}
          </p>
        );
    }
  });
}

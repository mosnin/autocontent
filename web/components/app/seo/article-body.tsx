// Tiny dependency-free markdown renderer for article bodies, styled with
// design-system tokens as a clean reading column (Detail template, /seo/[id]).
//
// The written-content pipeline emits plain CommonMark-ish markdown
// (headings, paragraphs, lists, links, emphasis, code). Rather than pull
// in a full renderer we hand-roll the subset we need and emit React
// elements directly — no dangerouslySetInnerHTML, so the article body
// can never inject markup.

import * as React from "react";
import { safeArticleUrl } from "./article-url";

// --- Inline parsing ------------------------------------------------------

// Alternation order matters: images before links, code before emphasis,
// bold before italic.
const INLINE =
  /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const token = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded-ds-xs bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("![")) {
      const alt = token.slice(2, token.indexOf("]"));
      // Untrusted target: only http(s), same-site paths and inline raster data. Otherwise show the alt text.
      const src = safeArticleUrl(token.slice(token.indexOf("](") + 2, -1), "image");
      if (!src) {
        if (alt) nodes.push(alt);
      } else {
        nodes.push(
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key}
            alt={alt}
            src={src.href}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="my-2 h-auto max-w-full rounded-ds-md border border-hairline"
          />,
        );
      }
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      // Untrusted target: only http(s) and same-site paths become links. Anything else keeps its words and loses the link.
      const link = safeArticleUrl(token.slice(token.indexOf("](") + 2, -1), "link");
      if (!link) {
        nodes.push(<React.Fragment key={key}>{renderInline(label, key)}</React.Fragment>);
      } else {
        nodes.push(
          <a
            key={key}
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="text-ds-accent underline decoration-ds-accent/30 underline-offset-2 hover:decoration-ds-accent"
          >
            {renderInline(label, key)}
          </a>,
        );
      }
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-medium text-fg">
          {renderInline(token.slice(2, -2), key)}
        </strong>,
      );
    } else {
      // *italic* or _italic_
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    last = idx + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// --- Block parsing -------------------------------------------------------

const HEADING_CLASSES: Record<number, string> = {
  1: "!mt-2 text-[22px] font-medium leading-tight tracking-[-0.01em] text-fg",
  2: "!mt-9 text-[18px] font-medium leading-snug text-fg",
  3: "!mt-7 text-[15.5px] font-medium text-fg",
  4: "!mt-5 text-[14.5px] font-medium text-fg",
  5: "!mt-5 text-[14px] font-medium text-fg",
  6: "!mt-5 text-[14px] font-medium text-fg-muted",
};

export function ArticleBody({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — block separator.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-ds-md border border-hairline bg-surface-2 p-3 font-mono text-[12px] leading-relaxed"
        >
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <Tag key={key++} className={HEADING_CLASSES[level]}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="!my-8 border-hairline" />);
      i++;
      continue;
    }

    // Blockquote.
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 border-hairline-strong pl-4 text-fg-muted"
        >
          {renderInline(buf.join(" "), `bq${key}`)}
        </blockquote>,
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1.5 pl-5 marker:text-fg-faint">
          {items.map((item, n) => (
            <li key={n}>{renderInline(item, `ul${key}-${n}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-1.5 pl-5 marker:text-fg-faint">
          {items.map((item, n) => (
            <li key={n}>{renderInline(item, `ol${key}-${n}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph — greedily consume until the next blank line or block start.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+\.\s|\s*>\s?|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(
        lines[i],
      )
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {renderInline(buf.join(" "), `p${key}`)}
      </p>,
    );
  }

  return (
    <div className="space-y-4 text-[15px] leading-[1.7] text-fg [overflow-wrap:anywhere]">
      {blocks}
    </div>
  );
}

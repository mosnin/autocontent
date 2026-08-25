import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A terminal-style code block: the three-dot bar, a mono filename, and the
 * lines beneath it.
 *
 * `sections.css` already ships `os-codeblock`, `os-codeblock__bar`,
 * `os-codeblock__dot`, `os-pre` and the `os-tok-*` colour tokens, but
 * nothing rendered them. The automation page is the surface that needs
 * them - an API, an SDK, a CLI and an MCP server are best shown by
 * showing the call - so the markup lives here rather than being inlined
 * into a page.
 *
 * Colouring is intentionally shallow: comment lines, shell prompts and
 * quoted strings. Anything cleverer would be a syntax highlighter, which
 * is a client-side dependency this page does not need. Server component.
 */
function tokenize(line: string, key: number): React.ReactNode {
  const trimmed = line.trimStart();

  // A whole-line comment, in either dialect the samples use.
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return (
      <span className="os-tok-com" key={key}>
        {line}
        {"\n"}
      </span>
    );
  }

  // Shell prompt: the `$` is a marker, not part of the command.
  let rest = line;
  const parts: React.ReactNode[] = [];
  if (trimmed.startsWith("$ ")) {
    const indent = line.slice(0, line.length - trimmed.length);
    parts.push(
      <span className="os-tok-dim" key="prompt">
        {indent}${" "}
      </span>,
    );
    rest = trimmed.slice(2);
  }

  // Quoted strings, so a payload reads as a payload.
  const segments = rest.split(/("[^"]*")/g);
  segments.forEach((seg, i) => {
    if (!seg) return;
    if (seg.startsWith('"') && seg.endsWith('"') && seg.length > 1) {
      parts.push(
        <span className="os-tok-str" key={`s${i}`}>
          {seg}
        </span>,
      );
    } else {
      parts.push(<React.Fragment key={`t${i}`}>{seg}</React.Fragment>);
    }
  });

  return (
    <React.Fragment key={key}>
      {parts}
      {"\n"}
    </React.Fragment>
  );
}

export function CodeSample({
  title,
  lines,
  className,
}: {
  /** Filename or surface name shown in the bar. */
  title: string;
  lines: string[];
  className?: string;
}) {
  return (
    <div className={cn("os-codeblock", className)}>
      <div className="os-codeblock__bar">
        <span aria-hidden className="os-codeblock__dot" />
        <span aria-hidden className="os-codeblock__dot" />
        <span aria-hidden className="os-codeblock__dot" />
        <span className="os-codeblock__title">{title}</span>
      </div>
      <pre className="os-pre">
        <code>{lines.map((l, i) => tokenize(l, i))}</code>
      </pre>
    </div>
  );
}

"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { EASE } from "@/components/marketing/system";

/* ------------------------------------------------------------------ */
/* Syntax-tinted spans (hand-built, no highlighter dependency)         */
/* ------------------------------------------------------------------ */

/*
 * Syntax tints. The palette has one hue, so code is differentiated by
 * luminance rather than by inventing four colours the site never uses:
 * keywords take the accent, strings the brightest ink, everything else
 * steps down the grey ramp.
 */
function K({ children }: { children: React.ReactNode }) {
  // keywords / commands
  return <span className="os-tok-key">{children}</span>;
}
function S({ children }: { children: React.ReactNode }) {
  // strings
  return <span className="os-tok-str">{children}</span>;
}
function C({ children }: { children: React.ReactNode }) {
  // comments / output
  return <span className="os-tok-com">{children}</span>;
}
function F({ children }: { children: React.ReactNode }) {
  // flags / properties
  return <span className="os-tok-flag">{children}</span>;
}
function P({ children }: { children: React.ReactNode }) {
  // prompt / punctuation dimmed
  return <span className="os-tok-dim">{children}</span>;
}

function CodeBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="os-codeblock">
      <div className="os-codeblock__bar">
        <span aria-hidden className="os-codeblock__dot" />
        <span aria-hidden className="os-codeblock__dot" />
        <span aria-hidden className="os-codeblock__dot" />
        <span className="os-codeblock__title">{title}</span>
      </div>
      <pre className="os-pre">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The four surfaces                                                   */
/* ------------------------------------------------------------------ */

type Surface = {
  id: string;
  label: string;
  blurb: string;
  note: string;
  code: React.ReactNode;
};

const SURFACES: Surface[] = [
  {
    id: "rest",
    label: "REST API",
    blurb:
      "Plain HTTPS with a personal access token. Enqueue an article, poll the job, fetch the result.",
    note: "Every enqueue response includes the estimated cost, so callers can decide before work starts.",
    code: (
      <CodeBlock title="terminal">
        <K>curl</K> <F>-X</F> POST https://marketer.sh/api/v1/articles \{"\n"}
        {"  "}
        <F>-H</F> <S>&quot;Authorization: Bearer $MARKETER_PAT&quot;</S> \{"\n"}
        {"  "}
        <F>-H</F> <S>&quot;Content-Type: application/json&quot;</S> \{"\n"}
        {"  "}
        <F>-d</F> <S>&apos;{"{"}</S>
        {"\n"}
        {"        "}
        <S>&quot;niche_id&quot;: &quot;nch_9f2c1e&quot;,</S>
        {"\n"}
        {"        "}
        <S>&quot;topic&quot;: &quot;best budget espresso grinders&quot;</S>
        {"\n"}
        {"      "}
        <S>{"}"}&apos;</S>
        {"\n\n"}
        <C>
          {"{"} &quot;job_id&quot;: &quot;job_51ad&quot;, &quot;status&quot;:
          &quot;queued&quot;, &quot;estimated_cost_usd&quot;: 0.34 {"}"}
        </C>
      </CodeBlock>
    ),
  },
  {
    id: "sdk",
    label: "Python SDK",
    blurb:
      "An async client that mirrors the API one-to-one. Install with pip install marketer.",
    note: "The client reads MARKETER_PAT from the environment and retries with backoff by default.",
    code: (
      <CodeBlock title="agent.py">
        <K>from</K> marketer <K>import</K> MarketerClient{"\n\n"}
        <K>async</K> <K>with</K> MarketerClient() <K>as</K> c:{"\n"}
        {"    "}job = <K>await</K> c.generate_article({"\n"}
        {"        "}
        <F>niche_id</F>=<S>&quot;nch_9f2c1e&quot;</S>,{"\n"}
        {"        "}
        <F>topic</F>=<S>&quot;best budget espresso grinders&quot;</S>,{"\n"}
        {"    "}){"\n"}
        {"    "}
        <K>print</K>(job.status, job.estimated_cost_usd){"\n"}
        {"    "}
        <C># queued 0.34</C>
      </CodeBlock>
    ),
  },
  {
    id: "cli",
    label: "CLI",
    blurb:
      "The same surface from a terminal. marketer niches, jobs, and articles commands cover the daily loop.",
    note: "Estimates and remaining cap print with every enqueue. Nothing spends silently.",
    code: (
      <CodeBlock title="terminal">
        <P>$ </P>
        <K>marketer</K> niches list{"\n"}
        <C> nch_9f2c1e home-espresso cap $10/day 2 windows</C>
        {"\n\n"}
        <P>$ </P>
        <K>marketer</K> articles generate <F>--niche</F> nch_9f2c1e \{"\n"}
        {"    "}
        <F>--topic</F> <S>&quot;best budget espresso grinders&quot;</S>
        {"\n"}
        <C>→ queued · est $0.34 · today $2.10 of $10.00</C>
        {"\n\n"}
        <P>$ </P>
        <K>marketer</K> jobs watch job_51ad
      </CodeBlock>
    ),
  },
  {
    id: "mcp",
    label: "MCP server",
    blurb:
      "Add marketer-mcp to any MCP-capable agent and it gets tools like generate_article, enqueue_job, and today_spend.",
    note: "Tool descriptions state what each call costs before the agent spends, and today_spend lets it check the budget first.",
    code: (
      <CodeBlock title="mcp.json">
        {"{"}
        {"\n"}
        {"  "}
        <F>&quot;mcpServers&quot;</F>: {"{"}
        {"\n"}
        {"    "}
        <F>&quot;marketer&quot;</F>: {"{"}
        {"\n"}
        {"      "}
        <F>&quot;command&quot;</F>: <S>&quot;uvx&quot;</S>,{"\n"}
        {"      "}
        <F>&quot;args&quot;</F>: [<S>&quot;marketer-mcp&quot;</S>],{"\n"}
        {"      "}
        <F>&quot;env&quot;</F>: {"{"} <F>&quot;MARKETER_PAT&quot;</F>:{" "}
        <S>&quot;mkt_…&quot;</S> {"}"}
        {"\n"}
        {"    "}
        {"}"}
        {"\n"}
        {"  "}
        {"}"}
        {"\n"}
        {"}"}
      </CodeBlock>
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Accessible tabbed panels for the four developer surfaces. Arrow keys move
 * between tabs; panels cross-fade (static under reduced motion).
 */
export function CodeTabs() {
  const reduced = useReducedMotion();
  const [active, setActive] = React.useState(0);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (active + 1) % SURFACES.length;
    if (e.key === "ArrowLeft")
      next = (active - 1 + SURFACES.length) % SURFACES.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = SURFACES.length - 1;
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      tabRefs.current[next]?.focus();
    }
  };

  const surface = SURFACES[active];

  return (
    <div>
      <div
        aria-label="Developer surfaces"
        className="os-tabs"
        onKeyDown={onKeyDown}
        role="tablist"
      >
        {SURFACES.map((s, i) => (
          <button
            aria-controls={`surface-panel-${s.id}`}
            aria-selected={i === active}
            className="os-tab"
            id={`surface-tab-${s.id}`}
            key={s.id}
            onClick={() => setActive(i)}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            tabIndex={i === active ? 0 : -1}
            type="button"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`surface-tab-${surface.id}`}
        className="os-mt-24"
        id={`surface-panel-${surface.id}`}
        role="tabpanel"
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
            initial={reduced ? { opacity: 1 } : { opacity: 0, y: 12 }}
            key={surface.id}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <p className="os-body os-body--bright os-measure">{surface.blurb}</p>
            <div className="os-mt-20">{surface.code}</div>
            <ul className="os-bullets os-mt-16 os-measure">
              <li>{surface.note}</li>
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormatSelect } from "./production-library";
import {
  emptyBrief,
  productionRequest,
  type Brief,
  type LibraryPage,
  type ProductionRecord,
} from "@/lib/production";

const field = "flex min-w-0 flex-col gap-2 text-sm";
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-7">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="max-w-2xl text-sm text-foreground/75">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function ProductionWorkbench({
  initial,
}: {
  initial: ProductionRecord;
}) {
  const [record, setRecord] = useState(initial);
  const [brief, setBrief] = useState<Brief>(initial.state.brief ?? emptyBrief);
  const [tab, setTab] = useState("brief");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [anchor, setAnchor] = useState("whole");
  const [blocking, setBlocking] = useState(true);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [handoffText, setHandoffText] = useState("");
  const [handoffUrl, setHandoffUrl] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeUrl, setOutcomeUrl] = useState("");
  const [handoffVersion, setHandoffVersion] = useState("");
  const dirty =
    JSON.stringify(brief) !== JSON.stringify(record.state.brief ?? emptyBrief);
  const item = record.source.item;
  const staleApproval = !!record.state.approval && !record.approved;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change<K extends keyof Brief>(key: K, value: Brief[K]) {
    setBrief((old) => ({ ...old, [key]: value }));
  }
  async function send(action: string, fields: Record<string, unknown> = {}) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await productionRequest<ProductionRecord>(
        `/${item.id.replace(":", "/")}`,
        {
          action,
          expected_version: record.version,
          source_fingerprint: record.source.fingerprint,
          ...fields,
        },
      );
      setRecord(next);
      if (action === "save") setBrief(next.state.brief ?? emptyBrief);
      setMessage(
        action === "save"
          ? "Brief saved."
          : action === "approve"
            ? "This creative version is approved for handoff."
            : "Recorded in the creative history.",
      );
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-8 sm:px-8">
      <header className="space-y-4">
        <Link
          href="/production"
          className="inline-flex min-h-11 items-center text-sm text-foreground/75 hover:underline"
        >
          Back to production
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm text-foreground/75">
              {item.kind.replaceAll("-", " ")} ·{" "}
              {item.status.replaceAll("_", " ")}
            </p>
            <h1 className="break-words text-3xl font-semibold tracking-tight">
              {item.title}
            </h1>
            <p className="text-sm text-foreground/75">
              Brief version {record.brief_version} ·{" "}
              {record.approved
                ? "Approved for handoff"
                : staleApproval
                  ? "Source or brief changed since approval"
                  : "Preparing for review"}
            </p>
          </div>
          {item.sourceUrl !== item.productionUrl && (
            <a
              className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm hover:bg-accent"
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Inspect source creative
            </a>
          )}
        </div>
      </header>
      {(item.sourceUrl === item.productionUrl || item.kind === "ad") && (
        <CreativeOutput record={record} />
      )}
      {staleApproval && (
        <p className="rounded-xl border p-4 text-sm">
          The previous approval is kept in history. Review the current creative
          and brief before the next handoff.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-destructive p-4"
        >
          <p>{error}</p>
          <p className="text-sm">
            Your unsaved text is still here. If the source changed, copy any
            text you want to keep, then reload this page.
          </p>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <nav
        aria-label="Production sections"
        className="flex flex-wrap gap-2 border-b pb-3"
      >
        {[
          { id: "brief", label: "Delivery brief" },
          { id: "review", label: "Review & approval" },
          { id: "delivery", label: "Handoffs & results" },
        ].map((entry) => (
          <Button
            key={entry.id}
            variant={tab === entry.id ? "default" : "ghost"}
            className="min-h-11"
            aria-current={tab === entry.id ? "page" : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </nav>
      {tab === "brief" && (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            void send("save", { brief });
          }}
        >
          <Section
            title="What this work needs to do"
            description="A brief for delivery. Use the source creative's existing tools to change its script, visuals or render."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <label className={field}>
                Objective
                <Textarea
                  rows={3}
                  value={brief.objective}
                  maxLength={2000}
                  onChange={(e) => change("objective", e.target.value)}
                  placeholder="What should change for the audience or business?"
                />
              </label>
              <label className={field}>
                Audience
                <Textarea
                  rows={3}
                  value={brief.audience}
                  maxLength={1500}
                  onChange={(e) => change("audience", e.target.value)}
                  placeholder="Who is this for, and what do they need?"
                />
              </label>
              <label className={field}>
                Owner
                <Input
                  className="min-h-11"
                  value={brief.owner}
                  maxLength={240}
                  onChange={(e) => change("owner", e.target.value)}
                  placeholder="Person accountable for delivery"
                />
              </label>
              <label className={field}>
                Due date
                <Input
                  className="min-h-11"
                  type="date"
                  value={brief.due_date}
                  onChange={(e) => change("due_date", e.target.value)}
                />
              </label>
            </div>
            <label className={field}>
              Delivery requirements
              <Textarea
                value={brief.deliverable}
                maxLength={2000}
                onChange={(e) => change("deliverable", e.target.value)}
                placeholder="Channel, format, dimensions, call to action and acceptance criteria"
              />
            </label>
          </Section>
          <Section
            title="Required inputs"
            description="Name what must be available before approval. Available inputs need a location or verification note."
          >
            {brief.inputs.map((input, index) => (
              <div
                key={input.id}
                className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2"
              >
                <label className={field}>
                  Input {index + 1}
                  <Input
                    className="min-h-11"
                    required
                    maxLength={240}
                    value={input.label}
                    onChange={(e) =>
                      change(
                        "inputs",
                        brief.inputs.map((v, i) =>
                          i === index ? { ...v, label: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <div className={field}>
                  <span>Readiness</span>
                  <FormatSelect
                    label={`Readiness for input ${index + 1}`}
                    value={input.status}
                    options={[
                      { value: "missing", label: "Missing" },
                      { value: "unverified", label: "Needs verification" },
                      { value: "available", label: "Available" },
                    ]}
                    onChange={(status) =>
                      change(
                        "inputs",
                        brief.inputs.map((v, i) =>
                          i === index
                            ? { ...v, status: status as typeof v.status }
                            : v,
                        ),
                      )
                    }
                  />
                </div>
                <label className={field}>
                  Evidence or location
                  <Input
                    className="min-h-11"
                    maxLength={1000}
                    value={input.evidence}
                    onChange={(e) =>
                      change(
                        "inputs",
                        brief.inputs.map((v, i) =>
                          i === index ? { ...v, evidence: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 self-end justify-self-start"
                  onClick={() =>
                    change(
                      "inputs",
                      brief.inputs.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove input {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={brief.inputs.length >= 50}
              onClick={() =>
                change("inputs", [
                  ...brief.inputs,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    status: "missing",
                    evidence: "",
                  },
                ])
              }
            >
              Add required input
            </Button>
          </Section>
          <Section
            title="Company context"
            description="Pin the goal, brand guidance or approved Company OS brief used for this work. These are recorded references; external documents are not automatically monitored."
          >
            {brief.context.map((pin, index) => (
              <div key={index} className="space-y-4 rounded-xl border p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["label", "Reference name"],
                      ["url", "Document URL"],
                      ["revision", "Revision or dated version"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className={field} key={key}>
                      {label}
                      <Input
                        className="min-h-11"
                        type={key === "url" ? "url" : "text"}
                        required
                        maxLength={key === "url" ? 2000 : 160}
                        value={pin[key]}
                        onChange={(e) =>
                          change(
                            "context",
                            brief.context.map((v, i) =>
                              i === index ? { ...v, [key]: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className={field}>
                  Guidance applied
                  <Textarea
                    rows={2}
                    maxLength={3000}
                    value={pin.excerpt}
                    onChange={(e) =>
                      change(
                        "context",
                        brief.context.map((v, i) =>
                          i === index ? { ...v, excerpt: e.target.value } : v,
                        ),
                      )
                    }
                    placeholder="The relevant constraint or decision, in a few sentences"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() =>
                    change(
                      "context",
                      brief.context.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove reference {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={brief.context.length >= 20}
              onClick={() =>
                change("context", [
                  ...brief.context,
                  { label: "", url: "", revision: "", excerpt: "" },
                ])
              }
            >
              Add context reference
            </Button>
          </Section>
          <Section
            title="Variant lineage"
            description="Optional. Connect this work to the earlier creative it changes, and name the question the variation should test."
          >
            <VariantPicker
              value={brief.variant_of}
              currentId={item.id}
              onChange={(value) => change("variant_of", value)}
            />
            <label className={field}>
              What changed and why
              <Textarea
                rows={2}
                maxLength={1500}
                value={brief.hypothesis}
                onChange={(e) => change("hypothesis", e.target.value)}
                placeholder="For example: a clearer opening demonstration may improve completion. Treat that as a hypothesis until measured."
              />
            </label>
          </Section>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              className="min-h-11"
              type="submit"
              disabled={busy || !dirty}
            >
              {busy ? "Saving…" : "Save brief"}
            </Button>
            <p className="text-sm text-foreground/75">
              {dirty
                ? "Unsaved changes. Saving creates a new brief version."
                : "Brief is saved."}
            </p>
          </div>
        </form>
      )}
      {tab === "review" && (
        <div className="space-y-6">
          <Section
            title="Ready for handoff?"
            description="Production approval records this exact source and brief version. Existing publishing and ad budget controls still apply."
          >
            {dirty && (
              <p className="text-sm">
                Save your brief changes before approving.
              </p>
            )}
            {record.readiness.length ? (
              <ul className="list-disc space-y-2 pl-5 text-sm">
                {record.readiness.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                Required fields and inputs are present. Inspect the creative
                before approving.
              </p>
            )}
            <Button
              className="min-h-11"
              disabled={
                busy || dirty || !!record.readiness.length || record.approved
              }
              onClick={() => void send("approve")}
            >
              {record.approved
                ? "Current version approved"
                : "Approve current version"}
            </Button>
          </Section>
          <Section
            title="Review notes"
            description="Notes keep their source version and section. Notes on an older creative remain visible until resolved."
          >
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await send("note", { text: note, anchor, blocking }))
                  setNote("");
              }}
            >
              <div className="max-w-sm">
                <FormatSelect
                  label="Creative section"
                  value={anchor}
                  onChange={setAnchor}
                  options={record.source.anchors.map((a) => ({
                    value: a.id,
                    label: a.label,
                  }))}
                />
              </div>
              {record.source.anchors.find((a) => a.id === anchor)?.text && (
                <blockquote className="border-l-2 pl-4 text-sm text-foreground/75">
                  {record.source.anchors.find((a) => a.id === anchor)?.text}
                </blockquote>
              )}
              <label className={field}>
                Review note
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={3000}
                  required
                  placeholder="What needs to change, and what would make it acceptable?"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={blocking}
                  onChange={(e) => setBlocking(e.target.checked)}
                />
                Must be resolved before handoff
              </label>
              <Button
                className="min-h-11"
                variant="outline"
                type="submit"
                disabled={busy || !note.trim()}
              >
                Add note
              </Button>
            </form>
            {(record.state.notes ?? []).map((entry) => (
              <article key={entry.id} className="space-y-3 border-t pt-5">
                <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
                <p className="text-xs text-foreground/75">
                  {entry.anchor === "whole"
                    ? "Whole creative"
                    : `Scene ${Number(entry.anchor.split(":")[1]) + 1}`}{" "}
                  ·{" "}
                  {entry.source_fingerprint === record.source.fingerprint
                    ? "Current source"
                    : "Older source version"}{" "}
                  ·{" "}
                  {entry.resolved_at
                    ? "Resolved"
                    : entry.blocking
                      ? "Blocks handoff"
                      : "Suggestion"}
                </p>
                {entry.resolved_at ? (
                  <p className="text-sm text-foreground/75">
                    Resolution: {entry.resolution}
                  </p>
                ) : (
                  <form
                    className="flex flex-wrap gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send("resolve", {
                        note_id: entry.id,
                        text: resolution[entry.id],
                      });
                    }}
                  >
                    <label className={`${field} flex-1`}>
                      Resolution
                      <Input
                        className="min-h-11"
                        value={resolution[entry.id] ?? ""}
                        required
                        maxLength={3000}
                        onChange={(e) =>
                          setResolution((old) => ({
                            ...old,
                            [entry.id]: e.target.value,
                          }))
                        }
                        placeholder="Describe the fix or why no change is needed"
                      />
                    </label>
                    <Button
                      className="min-h-11 self-end"
                      variant="outline"
                      type="submit"
                      disabled={busy || !resolution[entry.id]?.trim()}
                    >
                      Resolve note
                    </Button>
                  </form>
                )}
              </article>
            ))}
          </Section>
        </div>
      )}
      {tab === "delivery" && (
        <div className="space-y-6">
          <Section
            title="Record a handoff"
            description="Capture where the approved version was delivered. This records your handoff; it does not publish or send a message."
          >
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await send("handoff", {
                    text: handoffText,
                    evidence_url: handoffUrl,
                  })
                ) {
                  setHandoffText("");
                  setHandoffUrl("");
                }
              }}
            >
              <label className={field}>
                Delivery location
                <Input
                  className="min-h-11"
                  type="url"
                  required
                  value={handoffUrl}
                  onChange={(e) => setHandoffUrl(e.target.value)}
                  placeholder="https://…"
                />
              </label>
              <label className={field}>
                Handoff note
                <Textarea
                  required
                  maxLength={3000}
                  value={handoffText}
                  onChange={(e) => setHandoffText(e.target.value)}
                  placeholder="What was delivered, to whom, and any usage constraints"
                />
              </label>
              <Button
                className="min-h-11"
                type="submit"
                disabled={busy || dirty || !record.approved}
              >
                Record approved handoff
              </Button>
              {!record.approved && (
                <p className="text-sm text-foreground/75">
                  Approve the current creative and brief first.
                </p>
              )}
            </form>
            {record.state.handoffs?.map((h) => (
              <div className="space-y-2 border-t pt-4 text-sm" key={h.version}>
                <a
                  href={h.url}
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Handoff {h.version} · {new Date(h.at).toLocaleString()}
                </a>
                <p className="whitespace-pre-wrap">{h.text}</p>
                <p className="text-xs text-foreground/75">
                  Brief version {h.brief_version} ·{" "}
                  {h.source_fingerprint === record.source.fingerprint
                    ? "Current source"
                    : "Earlier source"}
                </p>
              </div>
            ))}
          </Section>
          <Section
            title="What happened after delivery"
            description="Attach measured results to the handoff they describe, even after the creative changes. Include the measurement period, unsuccessful results and the next useful step."
          >
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await send("outcome", {
                    text: outcome,
                    evidence_url: outcomeUrl,
                    handoff_version: Number(handoffVersion),
                  })
                ) {
                  setOutcome("");
                  setOutcomeUrl("");
                }
              }}
            >
              <FormatSelect
                label="Handoff measured"
                value={handoffVersion || "none"}
                onChange={(v) => setHandoffVersion(v === "none" ? "" : v)}
                options={[
                  { value: "none", label: "Choose the handoff measured" },
                  ...(record.state.handoffs ?? []).map((h) => ({
                    value: String(h.version),
                    label: `Handoff ${h.version} · ${new Date(h.at).toLocaleDateString()}`,
                  })),
                ]}
              />
              <label className={field}>
                Result and next step
                <Textarea
                  required
                  maxLength={3000}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder="Metric, value, period and comparison. What should the next brief change?"
                />
              </label>
              <label className={field}>
                Evidence URL
                <Input
                  className="min-h-11"
                  type="url"
                  required
                  value={outcomeUrl}
                  onChange={(e) => setOutcomeUrl(e.target.value)}
                />
              </label>
              <Button
                className="min-h-11"
                variant="outline"
                type="submit"
                disabled={busy || !handoffVersion}
              >
                Record result
              </Button>
            </form>
            {record.state.outcomes?.map((result, i) => (
              <article key={i} className="space-y-2 border-t pt-4 text-sm">
                <p className="whitespace-pre-wrap">{result.text}</p>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Evidence for handoff {result.handoff_version}
                </a>
              </article>
            ))}
          </Section>
          <Section
            title="Recent history"
            description="The latest 50 changes. Saved brief revisions and review events remain in the production record."
          >
            <ol className="divide-y">
              {record.events.map((event) => (
                <li
                  key={event.version}
                  className="flex flex-wrap justify-between gap-3 py-3 text-sm"
                >
                  <span>
                    {event.action === "save"
                      ? "Brief saved"
                      : event.action.replaceAll("_", " ")}{" "}
                    · revision {event.version}
                  </span>
                  <time className="text-foreground/75">
                    {new Date(event.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      )}
    </div>
  );
}

function VariantPicker({
  value,
  currentId,
  onChange,
}: {
  value: string;
  currentId: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<LibraryPage | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      {value && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            className="underline"
            target="_blank"
            href={`/production/${value.replace(":", "/")}`}
          >
            Open source creative
          </Link>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={() => onChange("")}
          >
            Remove source
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${field} flex-1`}>
          Find source creative
          <Input
            className="min-h-11"
            value={search}
            maxLength={160}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search earlier work by title"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={async () => {
            try {
              setResults(
                await productionRequest<LibraryPage>(
                  `?search=${encodeURIComponent(search)}`,
                ),
              );
              setError("");
            } catch {
              setError("Could not search your library. Try again.");
            }
          }}
        >
          Find creative
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {results && (
        <div className="space-y-2">
          {results.items
            .filter((i) => i.id !== currentId)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="block min-h-11 w-full rounded-lg border px-4 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onChange(item.id);
                  setResults(null);
                }}
              >
                {item.title} · {item.kind}
              </button>
            ))}
          <p className="text-xs text-foreground/75">
            {results.nextCursor
              ? "Showing the first matches. Narrow the title to find older work."
              : "All matching creatives shown."}
          </p>
        </div>
      )}
    </div>
  );
}

function CreativeOutput({ record }: { record: ProductionRecord }) {
  const [previews, setPreviews] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [error, setError] = useState("");
  return (
    <Section
      title="Creative output"
      description="Inspect the generated output alongside its production brief."
    >
      {record.source.excerpt && (
        <p className="whitespace-pre-wrap text-sm">{record.source.excerpt}</p>
      )}
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: record.source.preview_count }, (_, index) => (
          <div className="max-w-sm space-y-2" key={index}>
            {previews[index] ? (
              <img
                src={previews[index]!}
                alt={`Creative image ${index + 1}`}
                className="max-h-96 rounded-xl object-contain"
              />
            ) : previews[index] === null ? (
              <p className="text-sm text-foreground/75">
                Image {index + 1} is no longer available in local storage. Check
                the media library archive.
              </p>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={loading !== null}
                onClick={async () => {
                  setLoading(index);
                  try {
                    const result = await productionRequest<{
                      dataUrl: string | null;
                    }>(
                      `/${record.source.item.id.replace(":", "/")}/preview?index=${index}`,
                    );
                    setPreviews((old) => ({ ...old, [index]: result.dataUrl }));
                    setError("");
                  } catch {
                    setError("Preview could not load. Try again.");
                  } finally {
                    setLoading(null);
                  }
                }}
              >
                {loading === index ? "Loading…" : `Preview image ${index + 1}`}
              </Button>
            )}
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </Section>
  );
}

"use client";

// Brand personas: a reusable voice (an extension of the brand kit, not a
// competitor to it) plus a locked visual reference and a chat surface.
//
// Two rules shape this screen:
//
//  1. EVERY TURN IS A METERED LLM CALL. So nothing here sends on the
//     user's behalf — no auto-send, no retry-on-failure, no speculative
//     prefetch of a reply. A 402 leaves the thread untouched and says so.
//  2. THE VISUAL REFERENCE IS WRITE-ONCE. Published creative can already
//     depend on that face, so locking is presented as irreversible and the
//     button disappears afterwards rather than silently 409ing.

import * as React from "react";
import useSWR from "swr";
import { Loader2, Lock, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentMark } from "@/components/orb";
import type { Niche } from "@/lib/types";
import {
  MAX_GREETING_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_NAME_CHARS,
  MAX_PERSONA_CHARS,
  MAX_TAGLINE_CHARS,
  MAX_VOICE_RULES_CHARS,
  clearPersonaMessages,
  createPersona,
  deletePersona,
  hasVisual,
  isRateLimited,
  isSpendCapped,
  lockPersonaVisual,
  personaKeys,
  personaMessagesFetcher,
  personasFetcher,
  sendPersonaMessage,
  visualUrl,
  type Persona,
  type PersonaMessage,
} from "@/lib/personas-client";

function errorText(e: unknown): string {
  if (isSpendCapped(e)) {
    return "Spend cap reached — this turn was not sent or charged. Raise the cap or top up to continue.";
  }
  if (isRateLimited(e)) return "Too many requests. Wait a moment and try again.";
  return e instanceof Error ? e.message : "Something went wrong";
}

// ------------------------------------------------------------------ create

const EMPTY = {
  name: "",
  tagline: "",
  persona: "",
  greeting: "",
  voice_rules: "",
};

function CreatePersona({
  niches,
  onCreated,
  onCancel,
}: {
  niches: Niche[];
  onCreated: (p: Persona) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = React.useState(EMPTY);
  const [nicheId, setNicheId] = React.useState("");
  const [bannedText, setBannedText] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const set = (key: keyof typeof EMPTY) => (v: string) =>
    setForm((f) => ({ ...f, [key]: v }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const created = await createPersona({
        ...form,
        banned_topics: bannedText
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        niche_id: nicheId || null,
      });
      toast.success(`Created ${created.name}`);
      onCreated(created);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form className="grid gap-3" onSubmit={submit}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">New persona</h3>
            <Button onClick={onCancel} size="sm" type="button" variant="ghost">
              <X className="size-4" />
            </Button>
          </div>

          <Field label="Name" required>
            <Input
              maxLength={MAX_NAME_CHARS}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="Sol"
              value={form.name}
            />
          </Field>

          <Field label="Tagline">
            <Input
              maxLength={MAX_TAGLINE_CHARS}
              onChange={(e) => set("tagline")(e.target.value)}
              placeholder="The plain-spoken product explainer"
              value={form.tagline}
            />
          </Field>

          <Field help="Backstory and personality. Treated as source data, never as instructions." label="Persona">
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
              maxLength={MAX_PERSONA_CHARS}
              onChange={(e) => set("persona")(e.target.value)}
              value={form.persona}
            />
          </Field>

          <Field label="Voice rules (do / don't)">
            <textarea
              className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
              maxLength={MAX_VOICE_RULES_CHARS}
              onChange={(e) => set("voice_rules")(e.target.value)}
              value={form.voice_rules}
            />
          </Field>

          <Field label="Opening line">
            <Input
              maxLength={MAX_GREETING_CHARS}
              onChange={(e) => set("greeting")(e.target.value)}
              value={form.greeting}
            />
          </Field>

          <Field help="One per line. The persona refuses these and redirects." label="Banned topics">
            <textarea
              className="min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm"
              onChange={(e) => setBannedText(e.target.value)}
              value={bannedText}
            />
          </Field>

          <Field help="Attributes this persona's spend to a niche and honors its daily cap." label="Niche">
            <select
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
              onChange={(e) => setNicheId(e.target.value)}
              value={nicheId}
            >
              <option value="">Account-level (no niche cap)</option>
              {niches.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex justify-end">
            <Button disabled={saving || !form.name.trim()} size="sm" type="submit">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  help,
  required,
  children,
}: {
  label: string;
  help?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {help ? <span className="text-[11px] text-muted-foreground">{help}</span> : null}
    </label>
  );
}

// -------------------------------------------------------------------- chat

function Conversation({ persona }: { persona: Persona }) {
  const { data, mutate, isLoading } = useSWR<PersonaMessage[]>(
    personaKeys.messages(persona.id),
    personaMessagesFetcher,
    // No refreshInterval: a conversation only changes when this user sends
    // something, and every poll would be a wasted request.
    { revalidateOnFocus: false },
  );
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const messages = data ?? [];

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const turn = await sendPersonaMessage(persona.id, content);
      setDraft("");
      await mutate([...messages, turn.user_message, turn.assistant_message], {
        revalidate: false,
      });
    } catch (e) {
      // Deliberately no retry — a retry is another charge the user did not ask for.
      toast.error(errorText(e));
    } finally {
      setSending(false);
    }
  }

  async function clear() {
    try {
      await clearPersonaMessages(persona.id);
      await mutate([], { revalidate: false });
      toast.success("Conversation cleared");
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Conversation</h3>
        {messages.length > 0 ? (
          <Button onClick={clear} size="sm" variant="ghost">
            <Trash2 className="size-4" /> Clear
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2">
        {isLoading ? <Skeleton className="h-16 w-full" /> : null}
        {!isLoading && messages.length === 0 && persona.greeting ? (
          <Bubble content={persona.greeting} role="assistant" who={persona.name} />
        ) : null}
        {messages.map((m) => (
          <Bubble content={m.content} key={m.id} role={m.role} who={persona.name} />
        ))}
      </div>

      <form className="flex items-end gap-2" onSubmit={send}>
        <textarea
          className="min-h-16 flex-1 rounded-md border border-border bg-background p-2 text-sm"
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Ask ${persona.name} for copy…`}
          value={draft}
        />
        <Button disabled={sending || !draft.trim()} size="sm" type="submit">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        Each send is one metered call, billed to{" "}
        {persona.niche_id ? "this persona's niche" : "your account"}.
      </p>
    </div>
  );
}

function Bubble({
  role,
  content,
  who,
}: {
  role: string;
  content: string;
  who: string;
}) {
  const mine = role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          mine
            ? "max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
            : "max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm"
        }
      >
        {!mine ? (
          <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{who}</div>
        ) : null}
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- shell

export function PersonasClient({
  initialPersonas,
  niches,
}: {
  initialPersonas: Persona[];
  niches: Niche[];
}) {
  const { data, mutate } = useSWR<Persona[]>(personaKeys.list(), personasFetcher, {
    fallbackData: initialPersonas,
  });
  const personas = data ?? [];

  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialPersonas[0]?.id ?? null,
  );
  const [creating, setCreating] = React.useState(false);
  const [locking, setLocking] = React.useState(false);

  const selected = personas.find((p) => p.id === selectedId) ?? null;

  async function lock(persona: Persona) {
    setLocking(true);
    try {
      await lockPersonaVisual(persona.id);
      toast.success("Reference locked");
      void mutate();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLocking(false);
    }
  }

  async function remove(persona: Persona) {
    try {
      await deletePersona(persona.id);
      if (selectedId === persona.id) setSelectedId(null);
      await mutate(
        personas.filter((p) => p.id !== persona.id),
        { revalidate: false },
      );
      toast.success(`Deleted ${persona.name}`);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <div className="grid gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Brand personas</h1>
          <p className="text-sm text-muted-foreground">
            A reusable voice built on your brand kit. Draft copy in-character, and
            lock a visual reference the rest of the pipeline can reuse.
          </p>
        </div>
        <Button onClick={() => setCreating((c) => !c)} size="sm">
          <Plus className="size-4" /> New persona
        </Button>
      </header>

      {creating ? (
        <CreatePersona
          niches={niches}
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setSelectedId(p.id);
            void mutate();
          }}
        />
      ) : null}

      {personas.length === 0 && !creating ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No personas yet. Create one to draft copy in a consistent voice.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        {personas.length > 0 ? (
          <nav className="grid content-start gap-1">
            {personas.map((p) => (
              <button
                className={
                  p.id === selectedId
                    ? "rounded-md bg-muted px-3 py-2 text-left text-sm font-medium"
                    : "rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/60"
                }
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                type="button"
              >
                <span className="block truncate">{p.name}</span>
                {p.tagline ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {p.tagline}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        ) : null}

        {selected ? (
          <Card>
            <CardContent className="grid gap-4 p-4">
              <div className="flex items-start gap-4">
                {hasVisual(selected) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`${selected.name} reference`}
                    className="size-20 rounded-md object-cover"
                    src={visualUrl(selected)}
                  />
                ) : (
                  // No locked reference yet — the agent mark stands in,
                  // because "not yet given a face" is precisely what it
                  // depicts. A grey box would just read as a broken image.
                  <div className="grid size-20 place-items-center rounded-md bg-black">
                    <AgentMark size={56} />
                  </div>
                )}
                <div className="grid flex-1 gap-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{selected.name}</h2>
                    {hasVisual(selected) ? (
                      <Badge variant="secondary">Reference locked</Badge>
                    ) : null}
                  </div>
                  {selected.tagline ? (
                    <p className="text-sm text-muted-foreground">{selected.tagline}</p>
                  ) : null}
                  <div className="flex gap-2 pt-1">
                    {!hasVisual(selected) ? (
                      <Button
                        disabled={locking}
                        onClick={() => lock(selected)}
                        size="sm"
                        variant="outline"
                      >
                        {locking ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Lock className="size-4" />
                        )}
                        Lock visual reference
                      </Button>
                    ) : null}
                    <Button onClick={() => remove(selected)} size="sm" variant="ghost">
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </div>
                  {!hasVisual(selected) ? (
                    <p className="text-[11px] text-muted-foreground">
                      Locking generates one image and fixes this persona&apos;s look
                      permanently — creative you publish later can depend on it.
                    </p>
                  ) : null}
                </div>
              </div>

              <Separator />
              <Conversation persona={selected} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

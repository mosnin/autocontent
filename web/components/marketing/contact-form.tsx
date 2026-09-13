"use client";

import { useState, type FormEvent, type ReactNode } from "react";

const REASONS = [
  "General question",
  "Sales",
  "Demo request",
  "Support",
  "Press",
  "Legal",
] as const;

export function ContactForm({
  initialReason = "General question",
  initialMessage = "",
}: {
  initialReason?: (typeof REASONS)[number];
  initialMessage?: string;
} = {}): ReactNode {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>(initialReason);
  const [message, setMessage] = useState(initialMessage);
  const [sent, setSent] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName || !trimmedEmail || !trimmedMessage) return;

    const subject = encodeURIComponent(`[${reason}] ${trimmedName}`);
    const body = encodeURIComponent(
      [
        trimmedMessage,
        "",
        `Name: ${trimmedName}`,
        `Email: ${trimmedEmail}`,
        company.trim() ? `Company: ${company.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    window.location.href = `mailto:hello@marketer.sh?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="border-border rounded-3xl border p-6 sm:p-8"
    >
      {sent && (
        <div
          role="status"
          className="mb-6 rounded-2xl bg-muted p-5 text-sm leading-relaxed"
        >
          Your email app should open with the draft. Send it there to contact
          us. If nothing opened, email hello@marketer.sh directly. Your details
          remain below.
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-foreground text-sm font-medium">Name</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm focus-ring"
          />
        </label>
        <label className="block">
          <span className="text-foreground text-sm font-medium">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm focus-ring"
          />
        </label>
      </div>

      <label className="mt-5 block">
        <span className="text-foreground text-sm font-medium">
          Company (optional)
        </span>
        <input
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          autoComplete="organization"
          className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm focus-ring"
        />
      </label>

      <label className="mt-5 block">
        <span className="text-foreground text-sm font-medium">
          What is this about?
        </span>
        <select
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as (typeof REASONS)[number])
          }
          className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm focus-ring"
        >
          {REASONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-5 block">
        <span
          className="text-foreground text-sm font-medium"
          id="contact-message-label"
        >
          Message
        </span>
        <textarea
          aria-labelledby="contact-message-label"
          required
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
          className="border-border bg-background text-foreground mt-2 w-full rounded-3xl border px-4 py-3 text-sm focus-ring"
        />
      </label>

      <button
        type="submit"
        className="focus-ring bg-foreground text-background mt-6 inline-flex h-12 items-center rounded-full px-7 text-sm font-medium transition-opacity hover:opacity-85"
      >
        Open email draft
      </button>
    </form>
  );
}

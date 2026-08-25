"use client";

import { useState, type FormEvent, type ReactNode } from "react";

const REASONS = [
  "General question",
  "Sales",
  "Support",
  "Press",
  "Legal",
] as const;

export function ContactForm(): ReactNode {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("General question");
  const [message, setMessage] = useState("");
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
        .join("\n")
    );
    window.location.href = `mailto:hello@marketer.sh?subject=${subject}&body=${body}`;
    setSent(true);
  };

  if (sent) {
    return (
      <div className="border-border rounded-3xl border p-8">
        <h2 className="text-foreground text-2xl font-medium tracking-tight">
          Your email app should be open.
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          If nothing opened, write us at hello@marketer.sh. A person reads every
          message.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border-border rounded-3xl border p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-foreground text-sm font-medium">Name</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm outline-none"
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
            className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm outline-none"
          />
        </label>
      </div>

      <label className="mt-5 block">
        <span className="text-foreground text-sm font-medium">Company</span>
        <input
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          autoComplete="organization"
          className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm outline-none"
        />
      </label>

      <label className="mt-5 block">
        <span className="text-foreground text-sm font-medium">What is this about?</span>
        <select
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as (typeof REASONS)[number])
          }
          className="border-border bg-background text-foreground mt-2 h-12 w-full rounded-full border px-4 text-sm outline-none"
        >
          {REASONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-5 block">
        <span className="text-foreground text-sm font-medium">Message</span>
        <textarea
          required
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
          className="border-border bg-background text-foreground mt-2 w-full rounded-3xl border px-4 py-3 text-sm outline-none"
        />
      </label>

      <button
        type="submit"
        className="focus-ring bg-foreground text-background mt-6 inline-flex h-12 items-center rounded-full px-7 text-sm font-medium transition-opacity hover:opacity-85"
      >
        Send message
      </button>
    </form>
  );
}

// Transactional email for auth: verification, password reset, invitations.
// Sent through the Resend HTTP API (no SDK). In development without a key the
// message, link included, goes to the server console so the flows can be used
// locally and by web/test/e2e-auth.cjs. In production without a key nothing is
// logged and sending fails, so a missing key is loud rather than a leak.

export interface AuthEmail {
  to: string;
  subject: string;
  /** The one link the message is about. */
  link: string;
  /** A one-time code to type on the page, shown above the link. */
  code?: string;
  /** Plain sentences, before the link. */
  lines: string[];
  action: string;
}

type Env = Record<string, string | undefined>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEmail(m: AuthEmail): { text: string; html: string } {
  const code = m.code && /^\d{4,10}$/.test(m.code) ? m.code : null;
  const text = [...m.lines, ...(code ? ["", `Your code: ${code}`] : []), "", `${m.action}: ${m.link}`, "", "If you didn't expect this, ignore it."].join("\n");
  const codeHtml = code ? `<p style="font-size:28px;font-weight:600;letter-spacing:0.18em;margin:20px 0">${code}</p>` : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#111">${m.lines.map((l) => `<p>${esc(l)}</p>`).join("")}${codeHtml}<p><a href="${esc(m.link)}">${esc(m.action)}</a></p><p style="color:#666">If you didn't expect this, ignore it.</p></div>`;
  return { text, html };
}

export async function sendAuthEmail(m: AuthEmail, env: Env = process.env): Promise<void> {
  const key = env.RESEND_API_KEY?.trim();
  const production = env.NODE_ENV === "production";
  if (!key) {
    if (production) throw new Error("RESEND_API_KEY is not set; auth email cannot be sent");
    // Development only: the e2e test reads this line.
    console.info(`[auth-email] to=${m.to} subject=${JSON.stringify(m.subject)}${m.code ? ` code=${m.code}` : ""} link=${m.link}`);
    return;
  }
  const from = env.EMAIL_FROM?.trim() || "Marketer <no-reply@marketer.sh>";
  const { text, html } = renderEmail(m);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  // Never log the body: it can echo the recipient and the link.
  if (!res.ok) throw new Error(`email provider refused the message (${res.status})`);
}

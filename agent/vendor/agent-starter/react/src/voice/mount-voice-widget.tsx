// Shadow-root mount + CSS injection + `:host` token overrides adapted from
// livekit-examples/agent-starter-embed `components/embed-popup/standalone-bundle-root.tsx` (commit 1cb7223).
// MIT License, Copyright (c) 2025 LiveKit, Inc. See ./THIRD_PARTY_NOTICES.md for the full notice.
// Changes: runtime options instead of build-time config, only the voice CSS is injected (not the
// whole app stylesheet), colors are sanitized, and the tenant comes from the publishable key on the
// server (`POST /voice/widget/session` + Origin allowlist), never from the page; the visitor identity is a
// server-signed credential, never a client-chosen id.
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { shadowStyles, VOICE_CSS } from "./styles.ts";
import { VoiceSession } from "./VoiceSession.tsx";

export interface MountVoiceWidgetOptions {
  /** Publishable key registered in KV `WIDGET_KEYS` (`widget:<key>` with a `voice` block). */
  publicKey: string;
  /** Origin of the Agent Starter Worker (`https://agents.example.com`). */
  apiBase: string;
  title?: string;
  startLabel?: string;
  /** Launcher accessible label. Default "Talk to us". */
  launcherLabel?: string;
  /** Hex colors only (anything else is ignored). */
  accent?: string;
  accentDark?: string;
  theme?: "light" | "dark";
  position?: "bottom-right" | "bottom-left";
  /** Show a recording-consent checkbox with this version (must match the tenant policy). */
  consentVersion?: string;
  /**
   * Server-signed visitor credential from a previous call (default: the one kept in localStorage).
   * The Worker mints the anonymous identity; a client-chosen visitor id proves nothing and is ignored.
   */
  visitor?: string;
  defaultOpen?: boolean;
  fetch?: typeof fetch;
}

export interface MountedVoiceWidget {
  readonly shadowRoot: ShadowRoot;
  unmount(): void;
}

const VISITOR_KEY = "agent_starter_voice_visitor";
const CREDENTIAL = /^[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{16,100}$/;

/** The stored visitor credential (`<id>.<signature>`), if any. Anything else (e.g. a legacy bare id) is dropped. */
export function storedVoiceVisitor(explicit?: string): string | undefined {
  if (explicit && CREDENTIAL.test(explicit)) return explicit;
  try {
    const stored = globalThis.localStorage?.getItem(VISITOR_KEY) ?? undefined;
    return stored && CREDENTIAL.test(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** Keep the credential the Worker returned, so the next call resumes the same anonymous visitor. */
export function rememberVoiceVisitor(credential: string | undefined): void {
  if (!credential || !CREDENTIAL.test(credential)) return;
  try {
    globalThis.localStorage?.setItem(VISITOR_KEY, credential);
  } catch {
    // storage blocked: the next call starts a fresh visitor
  }
}

function VoiceWidget({ options, initialVisitor }: { options: MountVoiceWidgetOptions; initialVisitor: string | undefined }) {
  const [open, setOpen] = useState(options.defaultOpen ?? false);
  const [visitor, setVisitor] = useState(initialVisitor);
  return (
    <div className="as-voice-widget" data-position={options.position ?? "bottom-right"}>
      {open ? (
        <VoiceSession
          title={options.title ?? "Talk to us"}
          {...(options.startLabel ? { startLabel: options.startLabel } : {})}
          {...(options.theme ? { theme: options.theme } : {})}
          endpoint={`${options.apiBase.replace(/\/+$/, "")}/voice/widget/session`}
          body={{ publicKey: options.publicKey, ...(visitor ? { visitor } : {}) }}
          onSessionStart={(details) => {
            rememberVoiceVisitor(details.visitor);
            if (details.visitor) setVisitor(details.visitor);
          }}
          simpleRequest
          credentials="omit"
          injectStyles={false}
          {...(options.consentVersion ? { consent: { version: options.consentVersion } } : {})}
          {...(options.fetch ? { fetch: options.fetch } : {})}
        />
      ) : null}
      <button type="button" className="as-voice-launcher" aria-expanded={open} aria-label={open ? "Close voice assistant" : (options.launcherLabel ?? "Talk to us")} onClick={() => setOpen(!open)}>
        {open ? (
          <span aria-hidden="true">×</span>
        ) : (
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </button>
    </div>
  );
}

/**
 * Mount the embeddable voice widget into a shadow root (page CSS cannot leak in or out).
 * The script tag passes only cosmetic options and the publishable key; the tenant and its
 * allowed origins are resolved server-side from the key.
 *
 *   mountVoiceWidget(document.body, { publicKey: "pk_live_…", apiBase: "https://agents.example.com" });
 */
export function mountVoiceWidget(target: Element | string = document.body, options: MountVoiceWidgetOptions): MountedVoiceWidget {
  const parent = typeof target === "string" ? document.querySelector(target) : target;
  if (!parent) throw new Error(`mountVoiceWidget: no element matches ${String(target)}`);
  if (!/^pk_[A-Za-z0-9_]{6,64}$/.test(options.publicKey)) throw new Error("mountVoiceWidget: invalid publicKey");
  const host = document.createElement("div");
  host.setAttribute("data-agent-starter-voice", "");
  if (options.theme === "dark") host.classList.add("dark");
  parent.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${shadowStyles({ ...(options.accent ? { accent: options.accent } : {}), ...(options.accentDark ? { accentDark: options.accentDark } : {}) })}\n${VOICE_CSS}`;
  shadowRoot.appendChild(style);
  const container = document.createElement("div");
  shadowRoot.appendChild(container);
  const root: Root = createRoot(container);
  root.render(<VoiceWidget options={options} initialVisitor={storedVoiceVisitor(options.visitor)} />);
  let mounted = true;
  return {
    shadowRoot,
    unmount() {
      if (!mounted) return;
      mounted = false;
      root.unmount();
      host.remove();
    },
  };
}

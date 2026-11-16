/**
 * Voice UI styles. Shipped as a string so the same CSS works on a page (rendered in a
 * `<style>` by `VoiceSession`) and inside the widget's shadow root. Every token falls back
 * to the `.as-root` design tokens of `@agent-starter/react/styles.css`, and to a literal
 * when that stylesheet is absent (shadow DOM).
 */
export const VOICE_CSS = `
.as-voice {
  --as-voice-accent: var(--as-color-accent, #2563eb);
  --as-voice-accent-contrast: var(--as-color-accent-contrast, #ffffff);
  --as-voice-bg: var(--as-color-bg, #ffffff);
  --as-voice-surface: var(--as-color-surface, #f7f7f8);
  --as-voice-text: var(--as-color-text, #111827);
  --as-voice-muted: var(--as-color-text-muted, #5b6170);
  --as-voice-border: var(--as-color-border, #e3e4e8);
  --as-voice-warning: var(--as-color-warning, #b45309);
  --as-voice-warning-soft: var(--as-color-warning-soft, #fef3c7);
  --as-voice-danger: var(--as-color-danger, #b91c1c);
  --as-voice-radius: var(--as-radius, 10px);
  font-family: var(--as-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: var(--as-font-size, 15px);
  color: var(--as-voice-text);
  background: var(--as-voice-bg);
  border: 1px solid var(--as-voice-border);
  border-radius: var(--as-radius-lg, 16px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}
.as-voice *, .as-voice *::before, .as-voice *::after { box-sizing: border-box; }
.as-voice[data-theme="dark"] {
  --as-voice-bg: #0f1115; --as-voice-surface: #181b22; --as-voice-text: #e6e8ee; --as-voice-muted: #9aa3b2; --as-voice-border: #2a2f3a;
  --as-voice-warning-soft: #3a2a0c;
}
.as-voice-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.as-voice-title { font-weight: 600; margin: 0; font-size: 1em; }
.as-voice-status { color: var(--as-voice-muted); font-size: 0.875em; }
.as-voice-consent { display: flex; gap: 8px; align-items: flex-start; font-size: 0.875em; color: var(--as-voice-muted); }
.as-voice-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.as-voice-button {
  appearance: none; border: 1px solid var(--as-voice-border); background: var(--as-voice-surface); color: var(--as-voice-text);
  border-radius: 999px; padding: 8px 16px; font: inherit; cursor: pointer;
}
.as-voice-button:focus-visible { outline: 2px solid var(--as-voice-accent); outline-offset: 2px; }
.as-voice-button[disabled] { opacity: 0.55; cursor: not-allowed; }
.as-voice-button--primary { background: var(--as-voice-accent); color: var(--as-voice-accent-contrast); border-color: transparent; }
.as-voice-button--danger { background: var(--as-voice-danger); color: #fff; border-color: transparent; }
.as-voice-visualizer { display: flex; align-items: center; justify-content: center; gap: 6px; height: 72px; }
.as-voice-bar {
  width: 10px; min-height: 10px; border-radius: 999px; background: var(--as-voice-border);
  transition: height 120ms ease, background-color 200ms ease;
}
.as-voice-bar[data-highlighted="true"] { background: var(--as-voice-accent); }
.as-voice-banner {
  border-radius: var(--as-voice-radius); padding: 8px 12px; font-size: 0.875em;
  background: var(--as-voice-warning-soft); color: var(--as-voice-warning);
}
.as-voice-error { color: var(--as-voice-danger); font-size: 0.875em; margin: 0; }
.as-voice-transcript { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
.as-voice-line { font-size: 0.9em; line-height: 1.45; }
.as-voice-line[data-speaker="user"] { color: var(--as-voice-muted); }
.as-voice-speaker { font-weight: 600; margin-right: 6px; }
.as-voice-recording { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8em; color: var(--as-voice-danger); }
.as-voice-recording::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.as-voice-widget { position: fixed; bottom: 20px; right: 20px; z-index: var(--as-widget-z, 2147483000); display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
.as-voice-widget[data-position="bottom-left"] { right: auto; left: 20px; align-items: flex-start; }
.as-voice-widget .as-voice { width: min(360px, calc(100vw - 40px)); box-shadow: var(--as-shadow-lg, 0 18px 50px rgb(16 24 40 / 0.18)); }
.as-voice-launcher {
  width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer; font-size: 22px;
  background: var(--as-voice-accent, #2563eb); color: var(--as-voice-accent-contrast, #fff); box-shadow: 0 6px 20px rgb(16 24 40 / 0.25);
}
.as-voice-launcher:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.as-voice-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Only literal hex colors are accepted: anything else could inject CSS. */
export function safeHexColor(value: string | undefined | null): string | undefined {
  return value && HEX.test(value.trim()) ? value.trim() : undefined;
}

/*
 * `shadowStyles` is adapted from livekit-examples/agent-starter-embed `lib/styles.ts`
 * (`getShadowStyles`, commit 1cb7223; MIT License, Copyright (c) 2025 LiveKit, Inc.; see
 * ./THIRD_PARTY_NOTICES.md). Changes: targets our `--as-*` tokens, and colors are sanitized
 * to hex before they are interpolated into CSS.
 */
export function shadowStyles(options: { accent?: string; accentDark?: string }): string {
  const accent = safeHexColor(options.accent);
  const accentDark = safeHexColor(options.accentDark);
  return [
    ":host { all: initial; }",
    accent ? `:host { --as-color-accent: ${accent}; --as-voice-accent: ${accent}; }` : "",
    accentDark ? `:host(.dark) { --as-color-accent: ${accentDark}; --as-voice-accent: ${accentDark}; }` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

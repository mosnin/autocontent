import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { ChatWidget } from "./components/ChatWidget.tsx";
import type { ChatWidgetProps } from "./components/ChatWidget.tsx";

export interface MountChatWidgetOptions {
  /**
   * URL of this package's `styles.css` to inject as a `<link>` (once per
   * document) when the host page does not load it itself.
   */
  stylesheetHref?: string;
}

export interface MountedChatWidget {
  /** Merges new props into the widget and re-renders it. */
  update(props: Partial<ChatWidgetProps>): void;
  /** Unmounts the widget (the injected stylesheet stays). */
  unmount(): void;
}

function ensureStylesheet(href: string): void {
  const exists = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][data-agent-starter]')].some((link) => link.getAttribute("href") === href);
  if (exists) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-agent-starter", "");
  document.head.appendChild(link);
}

/**
 * Mounts `<ChatWidget />` into a DOM element (or the first match of a CSS
 * selector) for non-React hosts, e.g. from a bundled `<script>` on a
 * marketing site:
 *
 * ```ts
 * const widget = mountChatWidget("#support", { url: "/api/agents/support/visitor-123", title: "Acme Support" });
 * widget.update({ brandColor: "#0f766e" });
 * ```
 */
export function mountChatWidget(target: Element | string, props: ChatWidgetProps, options: MountChatWidgetOptions = {}): MountedChatWidget {
  const element = typeof target === "string" ? document.querySelector(target) : target;
  if (!element) throw new Error(`mountChatWidget: no element matches ${String(target)}`);
  if (options.stylesheetHref) ensureStylesheet(options.stylesheetHref);
  const root: Root = createRoot(element);
  let current = props;
  root.render(<ChatWidget {...current} />);
  let mounted = true;
  return {
    update(next) {
      if (!mounted) return;
      current = { ...current, ...next };
      root.render(<ChatWidget {...current} />);
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      root.unmount();
    },
  };
}

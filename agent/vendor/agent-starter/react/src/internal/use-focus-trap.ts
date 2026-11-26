import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Tabbable descendants in DOM order, skipping hidden, inert and aria-hidden subtrees. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.closest("[hidden],[inert],[aria-hidden='true']"),
  );
}

export interface FocusTrapOptions {
  /** Called on Escape inside the trap. */
  onEscape?: () => void;
  /** Element focused when the trap activates; defaults to the first tabbable element. */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * While `active`, keeps Tab / Shift+Tab cycling inside `containerRef`, moves
 * focus into it on activation, and reports Escape. Restoring focus on close is
 * left to the caller, which knows where focus should land (e.g. the launcher).
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean, options: FocusTrapOptions = {}): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const preferred = optionsRef.current.initialFocus?.current;
    const target = (preferred && !preferred.matches(":disabled") ? preferred : undefined) ?? getFocusable(container)[0] ?? container;
    if (target === container && container.tabIndex < 0) container.tabIndex = -1;
    target.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (optionsRef.current.onEscape) {
          event.stopPropagation();
          optionsRef.current.onEscape();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable(container);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        container.focus();
        return;
      }
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === container || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [active, containerRef]);
}

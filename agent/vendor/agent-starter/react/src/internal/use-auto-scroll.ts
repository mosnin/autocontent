import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface AutoScroll<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onScroll: () => void;
  /** The viewport is pinned to the newest content. */
  atBottom: boolean;
  /** New content arrived while the user was scrolled up. */
  hasNew: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

/**
 * Keeps a scroll container pinned to its newest content while the user is
 * at the bottom, and stops following as soon as they scroll up (reporting
 * `hasNew` so the UI can offer a "jump to latest" control). Only an upward
 * scroll unpins, so content growth and programmatic or animated scrolls
 * never break the follow. `contentKey` should change whenever content grows.
 */
export function useAutoScroll<T extends HTMLElement>(contentKey: unknown, options: { enabled?: boolean; threshold?: number } = {}): AutoScroll<T> {
  const { enabled = true, threshold = 48 } = options;
  const ref = useRef<T>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
    const movedUp = element.scrollTop < lastTop.current - 1;
    lastTop.current = element.scrollTop;
    if (near) {
      pinned.current = true;
      setAtBottom(true);
      setHasNew(false);
    } else if (movedUp) {
      pinned.current = false;
      setAtBottom(false);
    }
  }, [threshold]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = ref.current;
    if (!element) return;
    pinned.current = true;
    if (typeof element.scrollTo === "function") element.scrollTo({ top: element.scrollHeight, behavior });
    else element.scrollTop = element.scrollHeight;
    lastTop.current = element.scrollTop;
    setAtBottom(true);
    setHasNew(false);
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    if (pinned.current) {
      element.scrollTop = element.scrollHeight;
      lastTop.current = element.scrollTop;
    } else {
      setHasNew(true);
    }
  }, [contentKey, enabled]);

  return { ref, onScroll, atBottom, hasNew, scrollToBottom };
}

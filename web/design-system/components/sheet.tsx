"use client";

import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx";
import { IconButton, useOutside } from "./primitives";

/**
 * A panel that slides in from the right edge: row detail, a small form beside
 * the work (add a field). Native modal `<dialog>`, like `Modal`: focus stays
 * inside, starts on the first field, Esc asks the owner to close, and focus
 * returns to what opened it. Slides 24px and fades, in 220ms, out 150ms.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  actions,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Icon buttons beside Close (more menu, open in full). */
  actions?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const isOpen = useRef(open);
  isOpen.current = open;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      (d.querySelector<HTMLElement>("[autofocus]") ?? d.querySelector<HTMLElement>("[data-sheet-body] :is(input, textarea, select, button, a[href]):not(:disabled)") ?? d.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    }
    if (!open && d.open) d.close();
    if (!open && opener.current) {
      const el = opener.current;
      opener.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open]);
  useEffect(
    () => () => {
      const el = opener.current;
      if (el?.isConnected) el.focus();
    },
    [],
  );
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClose={(e) => e.target === e.currentTarget && isOpen.current && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "ds-sheet fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-full overflow-hidden border-l border-hairline bg-overlay p-0 text-fg shadow-ds-modal",
        width === "sm" && "sm:w-[380px]",
        width === "md" && "sm:w-[460px]",
        width === "lg" && "sm:w-[560px]",
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex min-h-12 shrink-0 items-start gap-2 border-b border-hairline px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-[14px] font-medium leading-6">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[12.5px] text-fg-muted">{description}</p>}
            </div>
            {actions}
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </div>
          <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {children}
          </div>
          {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export type TagTone = "gray" | "blue" | "green" | "orange" | "red" | "purple" | "pink" | "teal" | "yellow";
export const TAG_TONES: readonly TagTone[] = ["gray", "blue", "green", "orange", "red", "purple", "pink", "teal", "yellow"];

/** A select option as a person coloured it: a soft fill with readable text in both themes. */
export function Tag({ tone = "gray", children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span data-tone={tone} className={cx("ds-tag inline-flex h-5 max-w-full items-center truncate rounded-ds-xs px-1.5 text-[12px] font-medium leading-5", className)}>
      {children}
    </span>
  );
}

/** The colour of a tag on its own (the colour picker). */
export function TagDot({ tone = "gray", className }: { tone?: string; className?: string }) {
  return <span aria-hidden data-tone={tone} className={cx("ds-tag ds-tag-dot inline-block size-3 shrink-0 rounded-full", className)} />;
}

/**
 * A small panel anchored to a button, for controls that are more than a list
 * (filters, sorts, which fields show). `Menu` is for picking one item; this is
 * for a little form. Esc or a click outside closes it and focus returns to the
 * trigger; focus starts on the first control inside.
 */
export function Popover({
  trigger,
  children,
  label,
  align = "left",
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void; "aria-expanded": boolean; "aria-haspopup": "dialog" }) => ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const refocus = () => ref.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  const close = useCallback(() => {
    setOpen(false);
    refocus();
  }, []);
  useOutside(ref, open, () => {
    const inside = ref.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (inside) refocus();
  });
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("input, select, textarea, button:not(:disabled)")?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v), "aria-expanded": open, "aria-haspopup": "dialog" })}
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          style={{ ["--origin" as string]: align === "left" ? "top left" : "top right" }}
          className={cx("ds-pop absolute top-full z-50 mt-1 w-[min(420px,calc(100vw-2rem))] rounded-ds-md border border-hairline bg-overlay p-3 shadow-ds-float", align === "left" ? "left-0" : "right-0", className)}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

"use client";

import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx";
import { IconButton, useOutside } from "./primitives";

/**
 * Sheet: a panel beside the page for secondary work: a flow's "Fine-tune"
 * options, a row's detail, a small form (add a field). A side panel from the
 * inline end on wide screens, a bottom sheet on phones. Same contract as
 * `Modal`: a native modal `<dialog>`, focus stays inside and starts on
 * `[autofocus]` or the first control, Esc and the scrim ask the owner to
 * close, and focus returns to what opened it. It slides in and out along the
 * same edge (tokens.css `dialog.ds-sheet`); reduced motion turns that into a cut.
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
  /** Icon buttons beside Close (delete, more, open in full). */
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
      (d.querySelector<HTMLElement>("[autofocus]") ??
        d.querySelector<HTMLElement>("[data-sheet-body] :is(input, textarea, select, button, a[href], [role=radio]):not(:disabled)") ??
        d.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
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
        "ds-sheet w-full overflow-hidden border-hairline bg-overlay p-0 text-fg shadow-ds-modal max-sm:rounded-t-ds-xl max-sm:border-t sm:border-s",
        width === "sm" && "sm:max-w-[380px]",
        width === "md" && "sm:max-w-[460px]",
        width === "lg" && "sm:max-w-[560px]",
      )}
    >
      <div className="flex h-full max-h-[inherit] flex-col">
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
        <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {children}
        </div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
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

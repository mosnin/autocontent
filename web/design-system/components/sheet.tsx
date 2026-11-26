"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "../cx";
import { IconButton } from "./primitives";

/**
 * Sheet: secondary settings beside the page (a side panel on wide screens, a
 * bottom sheet on phones). Same contract as `Modal`: a native modal
 * `<dialog>`, focus stays inside, Esc and the scrim ask the owner to close,
 * focus returns to what opened it. It slides in and out along the same edge
 * (tokens.css `dialog.ds-sheet`); reduced motion turns that into a cut.
 */
export function Sheet({ open, onClose, title, description, children, footer, width = "md" }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: "sm" | "md" }) {
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
      d.querySelector<HTMLElement>("[data-sheet-body] :is(input, textarea, select, button, [role=radio]):not(:disabled)")?.focus();
    }
    if (!open && d.open) d.close();
    if (!open && opener.current) {
      const el = opener.current;
      opener.current = null;
      if (el.isConnected) el.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClose={(e) => e.target === e.currentTarget && isOpen.current && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("ds-sheet w-full overflow-hidden border-hairline bg-overlay p-0 text-fg shadow-ds-modal max-sm:rounded-t-ds-xl max-sm:border-t sm:border-s", width === "sm" ? "sm:max-w-sm" : "sm:max-w-md")}
    >
      <div className="flex h-full max-h-[inherit] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[14px] font-medium">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[12px] text-fg-muted">{description}</p>}
          </div>
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

"use client";

// App-wide confirm dialog. Replaces the browser's native confirm(), which
// looks nothing like the product and can't carry a destructive tone. Mount
// <ConfirmProvider> once near the app root, then call useConfirm() anywhere:
//
//   const confirm = useConfirm();
//   if (await confirm({ title: "Archive channel?", confirmText: "Archive",
//                       destructive: true })) { ... }

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red). */
  destructive?: boolean;
}

type Ctx = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<Ctx | null>(null);

export function useConfirm(): Ctx {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<Ctx>((next) => {
    setOpts(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={opts !== null}
        onOpenChange={(o) => {
          // Closing by escape/overlay counts as cancel.
          if (!o) settle(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {opts && (
            <>
              <DialogHeader>
                <DialogTitle>{opts.title}</DialogTitle>
                {opts.description && (
                  <DialogDescription>{opts.description}</DialogDescription>
                )}
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => settle(false)}>
                  {opts.cancelText ?? "Cancel"}
                </Button>
                <Button
                  variant={opts.destructive ? "destructive" : "default"}
                  onClick={() => settle(true)}
                  autoFocus
                >
                  {opts.confirmText ?? "Confirm"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

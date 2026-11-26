"use client";

import { QrCode as ArkQr } from "@ark-ui/react/qr-code";
import { createContext, useContext, type ReactNode } from "react";
import { cx } from "../cx";

/* ------------------------------------------------------------ Permissions */
/*
 * What the signed-in person's role allows, for hiding or disabling controls.
 * The app shell provides it from the server's membership lookup; components
 * ask with useAllowed("campaign:launch"). With no provider the answer is no,
 * so a control never appears just because a page forgot to say who is
 * looking. The server is still the authority: this only shapes the UI.
 */
const PermissionsContext = createContext<ReadonlySet<string> | null>(null);

export function PermissionsProvider({ permissions, children }: { permissions: readonly string[]; children: ReactNode }) {
  return <PermissionsContext.Provider value={new Set(permissions)}>{children}</PermissionsContext.Provider>;
}

/** Whether the current role grants `permission` ("resource:action"). */
export function useAllowed(permission: string): boolean {
  return useContext(PermissionsContext)?.has(permission) ?? false;
}

/** One quiet line under a disabled control, saying which role can do it. */
export function NotAllowed({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[12px] text-fg-muted", className)}>{children}</p>;
}

/* ------------------------------------------------------------ QR code */
/*
 * A QR code for an authenticator app. Scanners need dark modules on a light
 * ground in both themes, so the tile is a fixed light fill with dark modules
 * (contrast is against that fill, not a surface token).
 */
export function QrCode({ value, label, size = 168 }: { value: string; label: string; size?: number }) {
  return (
    <div className="inline-flex shrink-0 self-start rounded-ds-md border border-hairline p-2.5" style={{ background: "white", color: "black" }}>
      <ArkQr.Root value={value} encoding={{ ecc: "M" }} style={{ width: size, height: size }} aria-label={label} role="img">
        <ArkQr.Frame style={{ width: "100%", height: "100%" }}>
          <ArkQr.Pattern style={{ fill: "currentColor" }} />
        </ArkQr.Frame>
      </ArkQr.Root>
    </div>
  );
}

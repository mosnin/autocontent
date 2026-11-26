"use client";

import { TwoFactorSection } from "./security-settings";

export function TwoFactorSetup({ next }: { next: string }) {
  return <TwoFactorSection title="Authenticator app" enabled={false} onEnabled={() => window.location.assign(next)} />;
}

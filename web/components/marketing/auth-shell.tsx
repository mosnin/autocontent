import { Logo } from "@/components/marketing/nav/logo";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { ThemeSwitch } from "@/components/marketing/theme-switch";
import type { ReactNode } from "react";

import { IntroDone } from "./intro-done";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-site flex min-h-screen flex-col">
      <IntroDone />
      <SkipToContent />
      <header className="flex h-20 items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-center justify-center px-4 pb-20"
      >
        {children}
      </main>
      <ThemeSwitch />
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-site flex min-h-screen flex-col">
      <IntroDone />
      <header className="flex h-20 items-center px-5 sm:px-8">
        <Logo />
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-center justify-center px-4 pb-20"
      >
        {children}
      </main>
      <ThemeSwitch />
    </div>
  );
}

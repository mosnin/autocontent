"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { IntroDone } from "@/components/marketing/intro-done";
import { Logo } from "@/components/marketing/nav/logo";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { ThemeSwitch } from "@/components/marketing/theme-switch";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SquareSidebar } from "@/components/square/sidebar";
import { SquareHeader } from "@/components/square/header";

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-site flex min-h-svh flex-col">
      <IntroDone />
      <SkipToContent />
      <header className="flex h-20 items-center px-5 sm:px-8">
        <Logo href="/home" />
      </header>
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-20 sm:px-8"
      >
        {children}
      </main>
      <ThemeSwitch />
    </div>
  );
}

/**
 * Logged-in shell. Onboarding keeps the marketing canvas. The rest of the
 * app uses the same Cortex tokens and chrome as the logged-out site:
 * flat white/black canvas, hairline rules, no floating warm panel.
 */
export function SiteShell({
  children,
  account,
}: {
  children: React.ReactNode;
  account?: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname.startsWith("/onboarding")) {
    return <OnboardingShell>{children}</OnboardingShell>;
  }

  return (
    <div className="marketing-site h-svh overflow-hidden">
      <SidebarProvider className="h-svh bg-background">
        <SquareSidebar account={account} />
        <div className="flex h-svh min-w-0 flex-1 flex-col bg-background">
          <SquareHeader />
          <main className="min-h-0 w-full flex-1 overflow-auto" id="main-content">
            <div className="mx-auto w-full max-w-[1440px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">
              {children}
            </div>
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
}

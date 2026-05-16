import type { Metadata } from "next";
import { ClerkProvider, SignedIn, SignedOut, UserButton, SignInButton } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "autocontent",
  description: "Autonomous short-form content creation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header style={{ display: "flex", justifyContent: "space-between", padding: 16 }}>
            <a href="/"><strong>autocontent</strong></a>
            <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <SignedIn>
                <a href="/dashboard">Dashboard</a>
                <a href="/queue">Queue</a>
                <a href="/connect">Connect socials</a>
                <a href="/settings/tokens">Settings</a>
                <UserButton />
              </SignedIn>
              <SignedOut>
                <SignInButton />
              </SignedOut>
            </nav>
          </header>
          <main style={{ padding: 16 }}>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}

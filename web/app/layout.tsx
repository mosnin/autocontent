import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// One family everywhere (Apple's single-typeface discipline): Geist for text
// and display, Geist Mono for data. Display presence comes from scale + tight
// tracking + the gradient-text accent, not a novelty face.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Inter is the app face (Podium DNA, see web/DESIGN.md); Geist stays for the
// marketing site and Geist Mono for numbers everywhere.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marketer",
  description: "An AI marketing department for people and agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable}`}
      >
        <body className="min-h-screen bg-background font-sans text-foreground antialiased">
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider delayDuration={150}>
              {children}
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
  );
}

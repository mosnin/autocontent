import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// The editorial triad, each face doing one job:
//   Instrument Serif — the APP's display face (`font-editorial`). The
//     identity carrier: a high-contrast serif against a grotesk UI is what
//     separates this from the Geist-everywhere default every AI-built
//     dashboard ships with. The marketing site keeps Geist for display.
//   Geist            — UI text. Neutral on purpose; it should recede.
//   Geist Mono       — data. Costs, durations, scores, model ids. Anything
//     that must align in a column or be read as a quantity.
// Display presence comes from the face plus scale, never from a gradient.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "marketer.sh",
  description: "Autonomous short-form content creation",
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
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
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

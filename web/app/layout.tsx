import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";

import "./globals.css";

import { Shell } from "./AppShell";
import { theme } from "./theme";

export const metadata: Metadata = {
  title: "autocontent",
  description: "Autonomous short-form content creation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" {...mantineHtmlProps}>
        <head>
          <ColorSchemeScript defaultColorScheme="auto" />
        </head>
        <body>
          <MantineProvider theme={theme} defaultColorScheme="auto">
            <Notifications position="top-right" />
            <Shell>{children}</Shell>
          </MantineProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

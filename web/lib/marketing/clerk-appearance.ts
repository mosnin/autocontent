import type { Appearance } from "@clerk/types";

/** Clerk chrome that matches the Cortex marketing canvas. */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "#0a0a0a",
    colorBackground: "#ffffff",
    colorText: "#0a0a0a",
    colorTextSecondary: "#737373",
    colorInputBackground: "#ffffff",
    colorInputText: "#0a0a0a",
    colorNeutral: "#0a0a0a",
    borderRadius: "0.9rem",
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  },
  elements: {
    rootBox: "mx-auto w-full max-w-[420px]",
    card: "shadow-none border border-border rounded-3xl bg-background",
    headerTitle: "font-medium tracking-tight text-[1.5rem]",
    headerSubtitle: "text-muted-foreground",
    formButtonPrimary:
      "bg-foreground text-background rounded-full shadow-none hover:opacity-85 hover:bg-foreground",
    socialButtonsBlockButton: "rounded-full border-border",
    formFieldInput: "rounded-xl bg-background",
    footerActionLink: "text-foreground hover:opacity-70",
  },
};

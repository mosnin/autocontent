"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const current = mounted ? (resolvedTheme ?? theme) : "dark";
  const isDark = current === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Toggle theme (currently ${current ?? "system"})`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      <span className="sr-only">
        Toggle theme (currently {current ?? "system"})
      </span>
    </Button>
  );
}

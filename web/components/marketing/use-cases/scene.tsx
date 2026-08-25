import { cn } from "@/lib/utils";

/**
 * Per-use-case section frames. Cortex is a flat canvas - scenes no longer
 * carry a colored wash; `name` is kept so existing pages type-check.
 */
export type SceneName =
  | "pearl"
  | "dusk"
  | "mint"
  | "tide"
  | "steel"
  | "daylight"
  | "aurora";

/** Flat muted panel; content is layered on top by the caller. */
export function UseCaseScene({
  name: _name,
  className,
  children,
}: {
  name: SceneName;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {children}
    </div>
  );
}

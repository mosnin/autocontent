import { cn } from "@/lib/utils";

/**
 * Power word: the one word in a title that carries the punch.
 * Bold + a thick brand underline sitting just below the baseline.
 * Use at most once or twice per heading — emphasis everywhere is
 * emphasis nowhere.
 */
export function Power({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-bold underline decoration-brand/70 decoration-[0.12em] underline-offset-[0.18em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

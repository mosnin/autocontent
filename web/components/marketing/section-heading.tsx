import { InView } from "@/lib/marketing/motion";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SectionHeading({
  title,
  description,
  align = "left",
}: {
  title: string;
  description?: ReactNode;
  align?: "left" | "center";
}): ReactNode {
  const centered = align === "center";

  return (
    <InView
      className={cn(
        "max-w-2xl",
        centered && "mx-auto flex flex-col items-center text-center"
      )}
    >
      <h2 className="text-foreground text-[clamp(30px,4.5vw,52px)] leading-[1.05] font-medium tracking-tight text-balance">
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground mt-5 max-w-xl text-base leading-relaxed">
          {description}
        </p>
      )}
    </InView>
  );
}

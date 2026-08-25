"use client";

import { SectionHeading } from "@/components/marketing/section-heading";
import { useReducedMotion } from "@/lib/marketing/motion";
import {
  Bot,
  Braces,
  Code,
  CreditCard,
  Instagram,
  Linkedin,
  Slack,
  Terminal,
  Twitter,
  Video,
  Webhook,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import {
  motion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useRef, type ReactNode } from "react";

type Integration = {
  name: string;
  blurb: string;
  icon: LucideIcon;
};

const ROW_A: Integration[] = [
  { name: "TikTok", blurb: "Scheduled posts", icon: Video },
  { name: "YouTube", blurb: "Straight to Shorts", icon: Youtube },
  { name: "Instagram", blurb: "Reels-ready", icon: Instagram },
  { name: "X", blurb: "Auto-post", icon: Twitter },
  { name: "LinkedIn", blurb: "Native posts", icon: Linkedin },
  { name: "Slack", blurb: "Share to channels", icon: Slack },
];

const ROW_B: Integration[] = [
  { name: "REST API", blurb: "Enqueue work", icon: Code },
  { name: "Python SDK", blurb: "Script it", icon: Braces },
  { name: "CLI", blurb: "From a terminal", icon: Terminal },
  { name: "MCP", blurb: "Hand it to an agent", icon: Bot },
  { name: "Stripe", blurb: "Prepaid credits", icon: CreditCard },
  { name: "Webhooks", blurb: "Anything custom", icon: Webhook },
];

/** Horizontal travel of each row across the section's scroll range, in px. */
const ROW_TRAVEL = 160;

function Pill({ integration }: { integration: Integration }): ReactNode {
  const Icon = integration.icon;
  return (
    <div className="border-border bg-background flex shrink-0 items-center gap-2.5 rounded-full border py-3.5 pr-5 pl-4 whitespace-nowrap">
      <Icon
        className="text-foreground size-4"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="text-foreground text-sm font-medium">
        {integration.name}
      </span>
      <span className="text-muted-foreground text-xs">{integration.blurb}</span>
    </div>
  );
}

function ScrubRow({
  items,
  x,
}: {
  items: Integration[];
  x: MotionValue<number> | undefined;
}): ReactNode {
  return (
    <div className="flex justify-center">
      <motion.div {...(x ? { style: { x } } : {})} className="flex w-max gap-3">
        {items.map((integration) => (
          <Pill key={integration.name} integration={integration} />
        ))}
        <div aria-hidden="true" className="flex gap-3">
          {items.map((integration) => (
            <Pill key={`copy-${integration.name}`} integration={integration} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export function Integrations(): ReactNode {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const xA = useTransform(scrollYProgress, [0, 1], [-ROW_TRAVEL, ROW_TRAVEL]);
  const xB = useTransform(scrollYProgress, [0, 1], [ROW_TRAVEL, -ROW_TRAVEL]);

  return (
    <section
      ref={sectionRef}
      id="integrations"
      className="scroll-mt-24 pb-24 sm:pb-32"
    >
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <SectionHeading
          align="center"
          title="Lands where you publish"
          description="Keepers route straight into the apps you post, pitch, and cut in. No export dance."
        />
      </div>

      <div className="mt-14 flex flex-col gap-3">
        <ScrubRow items={ROW_A} x={reduce ? undefined : xA} />
        <ScrubRow items={ROW_B} x={reduce ? undefined : xB} />
      </div>
    </section>
  );
}

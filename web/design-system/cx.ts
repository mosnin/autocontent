import { extendTailwindMerge } from "tailwind-merge";

/** Merges class names so a caller's class wins over a component default (w-48 beats w-full). */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["ds-2xs", "ds-xs", "ds-sm", "ds-md", "ds-lg", "ds-xl", "ds-bubble"],
      shadow: ["ds-float", "ds-modal"],
    },
  },
});

export function cx(...xs: (string | false | null | undefined | 0)[]) {
  return merge(xs.filter(Boolean).join(" "));
}

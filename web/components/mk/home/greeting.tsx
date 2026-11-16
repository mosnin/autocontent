"use client";

import { useEffect, useState } from "react";
import { Shader, type Palette } from "../shader";

/** Home greets you on light that follows the time of day (sunrise, sky, dusk, ember). */
function partOfDay(h: number): { word: string; palette: Palette } {
  if (h < 5) return { word: "Working late", palette: "ember" };
  if (h < 12) return { word: "Good morning", palette: "sunrise" };
  if (h < 18) return { word: "Good afternoon", palette: "sky" };
  return { word: "Good evening", palette: "dusk" };
}

export function Greeting({ summary }: { summary: string }) {
  const [p, setP] = useState<{ word: string; palette: Palette } | null>(null);
  useEffect(() => setP(partOfDay(new Date().getHours())), []);
  return (
    <div className="relative h-[148px] overflow-hidden rounded-[20px] border border-border sm:h-[164px]">
      <div className="absolute inset-0 dark:brightness-[0.88]">{p && <Shader palette={p.palette} />}</div>
      <div className="absolute inset-0 bg-gradient-to-r from-white/70 via-white/35 to-transparent" />
      <div className="relative flex h-full flex-col justify-end p-5 sm:p-6">
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.022em] text-black/90">{p?.word ?? "Hello"}</h1>
        <p className="mt-1 max-w-[52ch] text-[15px] text-black/65">{summary}</p>
      </div>
    </div>
  );
}

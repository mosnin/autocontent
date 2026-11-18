import { cookies } from "next/headers";
import { themeClass, THEME_COOKIE, type AppTheme } from "@/components/shell/theme";
import { WaveDemo } from "./wave-demo";

export const metadata = { title: "CommitWave · preview" };

/** The three CommitWave moments on real surfaces, for tuning and screenshots. See design-system/WAVE.md. */
export default async function WavePreview({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const sp = await searchParams;
  const theme: AppTheme = sp.theme === "light" ? "light" : sp.theme === "dark" ? "dark" : (((await cookies()).get(THEME_COOKIE)?.value as AppTheme) ?? "dark");
  return (
    <div className={`${themeClass(theme)} min-h-dvh bg-ds-bg p-8`}>
      <WaveDemo />
    </div>
  );
}

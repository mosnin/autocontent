import { cookies } from "next/headers";
import { THEME_COOKIE, themeClass } from "@/components/shell/theme";

export const dynamic = "force-dynamic";

/** Auth pages: outside the app shell, in the app's theme (dark by default). */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  return <div className={themeClass(theme)}>{children}</div>;
}

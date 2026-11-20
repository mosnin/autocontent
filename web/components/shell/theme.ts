// The app's own theme (dark by default), stored in a cookie so the server
// renders the right class and nothing flashes. Independent of the marketing
// site's theme.
export const THEME_COOKIE = "marketer-theme";
export type AppTheme = "dark" | "light";

export function themeClass(theme: AppTheme | undefined) {
  return theme === "light" ? "ds ds-light" : "ds";
}

export function setThemeCookie(theme: AppTheme) {
  // Secure on https; left off on http so local development still works.
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${secure}`;
}

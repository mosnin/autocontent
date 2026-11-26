// Infer the brand from the email domain (RULES §3.3: infer, then confirm).
// Personal domains infer nothing; the person types their brand instead.

const PERSONAL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "hey.com", "fastmail.com"]);

export function inferFromEmail(email: string): { brand: string | null; website: string | null } {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain || PERSONAL.has(domain)) return { brand: null, website: null };
  const root = domain.replace(/^(www|mail|app)\./, "");
  const name = root.split(".")[0] ?? "";
  const brand = name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { brand: brand || null, website: root };
}

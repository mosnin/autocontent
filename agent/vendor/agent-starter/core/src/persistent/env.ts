/**
 * Environment variables a persistent agent's VM commands must never see: GitHub tokens and anything that looks like
 * a token, secret, key or password. Apply it to every env map handed to a boat.dev VM command.
 */
const SENSITIVE = [/^GH_TOKEN$/i, /^GITHUB_TOKEN$/i, /_TOKEN$/i, /_SECRET$/i, /_KEY$/i, /PASSWORD/i, /^TOKEN$/i, /^SECRET$/i, /_CREDENTIALS?$/i];

export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE.some((pattern) => pattern.test(name));
}

export function filterSensitiveEnv<T extends Record<string, unknown>>(env: T | undefined | null): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(env ?? {})) if (!isSensitiveEnvName(name)) out[name] = value;
  return out as Partial<T>;
}

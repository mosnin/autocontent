export function cx(...xs: (string | false | null | undefined | 0)[]) {
  return xs.filter(Boolean).join(" ");
}

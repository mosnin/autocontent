/**
 * Fill a proof statement's {placeholders}. Numbers are formatted for humans; a missing
 * value leaves the placeholder visible so it is caught in review rather than shipped as "undefined".
 */
export function renderStatement(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (whole, key: string) => {
    const v = values[key];
    if (v === undefined || v === null) return whole;
    return typeof v === 'number' ? new Intl.NumberFormat('en-US').format(v) : String(v);
  });
}

export function missingPlaceholders(template: string, values: Record<string, string | number>): string[] {
  return [...template.matchAll(/\{([a-z_][a-z0-9_]*)\}/gi)].map((m) => m[1]!).filter((k) => values[k] === undefined);
}

export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Object.is(rounded, -0)) return '0';
  return String(rounded);
}

export function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const text = formatNum(value);
  return value > 0 ? `+${text}` : text;
}

export function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

export function roundCash(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

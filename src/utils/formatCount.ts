/**
 * Format a token count for display.
 * Small numbers get comma-separated digits; large numbers get K/M/B suffixes.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  return n.toExponential(2);
}

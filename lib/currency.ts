export function formatCurrencyFromCents(value: number | null | undefined) {
  const cents = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function parseCurrencyInputToCents(value: string) {
  const cleaned = value.trim().replace(/[$,]/g, '');
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;

  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

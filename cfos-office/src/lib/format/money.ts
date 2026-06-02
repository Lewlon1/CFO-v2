// Shared currency formatting. Single source of truth for the symbol + money
// string used across the CFO prompt surfaces (context-builder, first-read
// composition). Kept dependency-free so any layer can import it.

export function currencySymbol(currency: string): string {
  switch ((currency || 'EUR').toUpperCase()) {
    case 'GBP':
      return '£';
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    default:
      return currency + ' ';
  }
}

export function formatMoney(amount: number, currency: string): string {
  const sym = currencySymbol(currency);
  const rounded = Number.isInteger(amount) ? amount : Math.round(amount * 100) / 100;
  const hasCents = !Number.isInteger(rounded);
  return `${sym}${rounded.toLocaleString('en-GB', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

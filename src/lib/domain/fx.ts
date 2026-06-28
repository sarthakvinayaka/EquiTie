// FX conversion utilities — all conversions go via USD as the bridge currency.

/**
 * Convert amount from one currency to another using the provided fx map.
 * fxRates: currency → to_usd (e.g. GBP → 1.35 means 1 GBP = 1.35 USD).
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fxRates: Map<string, number>
): number {
  if (fromCurrency === toCurrency) return amount;

  const fromRate = fxRates.get(fromCurrency);
  const toRate = fxRates.get(toCurrency);

  if (!fromRate || !toRate) {
    // Unknown currency — return unconverted with a warning
    console.warn(`FX rate missing for ${fromCurrency} or ${toCurrency}`);
    return amount;
  }

  const amountUsd = amount * fromRate;
  return amountUsd / toRate;
}

export function fmt(
  amount: number,
  currency: string,
  decimals = 0
): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount);
  } catch {
    // Unknown currency code fallback
    return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }
}

export function fmtNum(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtMultiple(moic: number | null): string {
  if (moic === null) return "N/A";
  return `${moic.toFixed(2)}×`;
}

export function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

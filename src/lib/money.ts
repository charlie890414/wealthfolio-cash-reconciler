import Big from 'big.js';

export function moneyDecimalPlaces(_currency: string): number {
  return 2;
}

export function moneyValue(value: string | number | null | undefined): Big {
  if (value === null || value === undefined || String(value).trim() === '') return new Big(0);
  try { return new Big(String(value).replace(/,/g, '')); } catch { return new Big(0); }
}

export function roundMoney(value: Big | string | number, currency: string): number {
  return Number(new Big(value).round(moneyDecimalPlaces(currency), Big.roundHalfUp).toString());
}

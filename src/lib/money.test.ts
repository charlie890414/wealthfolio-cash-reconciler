import { describe, expect, it } from 'vitest';
import { moneyValue, roundMoney } from './money';

describe('money', () => {
  it('uses decimal arithmetic without binary floating point drift', () => {
    expect(moneyValue('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('rounds every currency to two decimal places', () => {
    expect(roundMoney('10.555', 'TWD')).toBe(10.56);
    expect(roundMoney('10.554', 'JPY')).toBe(10.55);
    expect(roundMoney('10.555', 'USD')).toBe(10.56);
  });
});

import { describe, expect, it } from 'vitest';
import { moneyValue, roundMoney } from './money';

describe('money', () => {
  it('uses decimal arithmetic without binary floating point drift', () => {
    expect(moneyValue('0.1').plus('0.2').toString()).toBe('0.3');
  });

  it('rounds zero-decimal and two-decimal currencies consistently', () => {
    expect(roundMoney('10.5', 'TWD')).toBe(11);
    expect(roundMoney('10.555', 'USD')).toBe(10.56);
  });
});

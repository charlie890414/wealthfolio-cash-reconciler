import { describe, expect, it } from 'vitest';
import { reconcile, type ReconciliationActivity } from './reconciliation';

function activity(overrides: Partial<ReconciliationActivity>): ReconciliationActivity {
  return {
    id: 'trade-1',
    accountId: 'account-1',
    accountName: 'Broker',
    activityType: 'BUY',
    date: '2026-09-01T09:00:00',
    symbol: 'TEST',
    quantity: 1,
    unitPrice: 100,
    amount: 100,
    currency: 'TWD',
    ...overrides,
  };
}

describe('reconcile excess cash', () => {
  it('proposes a withdrawal when deposits exceed the expected cash', () => {
    const report = reconcile([
      activity({}),
      activity({ id: 'cash-1', activityType: 'DEPOSIT', amount: 120, quantity: null, unitPrice: null }),
    ], { amountTolerance: 1 });

    expect(report.days[0].status).toBe('excess');
    expect(report.days[0].adjustmentProposals).toMatchObject([
      { activityType: 'WITHDRAWAL', amount: 20, status: 'excess' },
    ]);
  });

  it('does not propose the same adjustment after it has been applied', () => {
    const report = reconcile([
      activity({}),
      activity({ id: 'cash-1', activityType: 'DEPOSIT', amount: 120, quantity: null, unitPrice: null }),
      activity({
        id: 'adjustment-1',
        activityType: 'WITHDRAWAL',
        amount: 20,
        quantity: null,
        unitPrice: null,
        metadata: { generatedBy: 'tw-cash-reconciler', adjustmentType: 'excess' },
      }),
    ], { amountTolerance: 1 });

    expect(report.days[0].status).toBe('balanced');
    expect(report.days[0].adjustmentProposals).toEqual([]);
    expect(report.orphanCashActivities).toEqual([]);
  });

  it('does not add an excess adjustment when a stale generated activity will be reduced', () => {
    const report = reconcile([
      activity({}),
      activity({
        id: 'cash-1',
        activityType: 'DEPOSIT',
        amount: 120,
        quantity: null,
        unitPrice: null,
        metadata: { generatedBy: 'tw-cash-reconciler', relatedActivityId: 'trade-1' },
      }),
    ], { amountTolerance: 1 });

    expect(report.days[0].trades[0].proposal).toMatchObject({ amount: 100, existingActivityId: 'cash-1' });
    expect(report.days[0].adjustmentProposals).toEqual([]);
  });
});

describe('Wealthfolio 3.8 final cash amounts', () => {
  it('uses a BUY amount that already includes fees and taxes', () => {
    const report = reconcile([
      activity({ amount: 1010, fee: 10, tax: 0 }),
      activity({ id: 'cash-1', activityType: 'DEPOSIT', amount: 1010, quantity: null, unitPrice: null }),
    ], { amountTolerance: 0.01 });

    expect(report.days[0].trades[0]).toMatchObject({ status: 'covered', matchedAmount: 1010 });
    expect(report.totals.proposals).toBe(0);
  });

  it('uses a SELL final amount without subtracting fees and taxes again', () => {
    const report = reconcile([
      activity({ activityType: 'SELL', amount: 987, fee: 10, tax: 3 }),
      activity({ id: 'cash-1', activityType: 'WITHDRAWAL', amount: 987, quantity: null, unitPrice: null }),
    ], { amountTolerance: 0.01 });

    expect(report.days[0].trades[0]).toMatchObject({ status: 'covered', matchedAmount: 987 });
    expect(report.totals.proposals).toBe(0);
  });

  it('uses a cash dividend final amount without applying withholding twice', () => {
    const report = reconcile([
      activity({ activityType: 'DIVIDEND', amount: 90, fee: 0, tax: 10 }),
      activity({ id: 'cash-1', activityType: 'WITHDRAWAL', amount: 90, quantity: null, unitPrice: null }),
    ], { amountTolerance: 0.01 });

    expect(report.days[0].trades[0]).toMatchObject({ status: 'covered', matchedAmount: 90 });
    expect(report.totals.proposals).toBe(0);
  });

  it('keeps an explicit zero amount distinct from a missing amount', () => {
    const zero = reconcile([activity({ amount: 0, quantity: 1, unitPrice: 100 })], { amountTolerance: 0.01 });
    const missing = reconcile([activity({ amount: null, quantity: 1, unitPrice: 100 })], { amountTolerance: 0.01 });

    expect(zero.days[0].trades[0].expectation.expectedAmount).toBe(0);
    expect(missing.days[0].trades[0].expectation.expectedAmount).toBe(100);
  });

  it('does not create balancing cash for an unrelated cash row with missing amount', () => {
    const report = reconcile([
      activity({}),
      activity({ id: 'cash-unknown', activityType: 'DEPOSIT', amount: null, quantity: null, unitPrice: null }),
    ], { amountTolerance: 0.01 });

    expect(report.days[0].trades[0].status).toBe('partial');
    expect(report.days[0].trades[0].proposal).toBeUndefined();
    expect(report.totals.proposals).toBe(0);
  });

  it('does not clamp a derived SELL cash effect to zero when charges exceed proceeds', () => {
    const report = reconcile([activity({ activityType: 'SELL', amount: null, quantity: 1, unitPrice: 10, fee: 12, tax: 0 })], { amountTolerance: 0.01 });

    expect(report.days[0].trades[0].expectation.expectedAmount).toBe(2);
    expect(report.days[0].trades[0].expectation.expectedActivityType).toBe('WITHDRAWAL');
  });
});

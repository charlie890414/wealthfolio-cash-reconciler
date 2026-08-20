import assert from 'node:assert/strict';
import { reconcile, toReconciliationActivity } from '../src/domain/reconciliation.ts';

const mapped = toReconciliationActivity({
  id: 'in-kind-1',
  activityType: 'DIVIDEND',
  subtype: 'DIVIDEND_IN_KIND',
  date: new Date('2026-08-20T00:00:00Z'),
  quantity: '10',
  unitPrice: '25',
  amount: '250',
  fee: null,
  tax: null,
  currency: 'USD',
  accountId: 'account-1',
  accountName: 'Brokerage',
  assetSymbol: 'AAPL',
});

assert.equal(mapped.subtype, 'DIVIDEND_IN_KIND');

const report = reconcile([mapped], { amountTolerance: 0.01 });
assert.equal(report.totals.proposals, 0);
assert.equal(report.days.length, 0);

const regularDividend = { ...mapped, id: 'cash-dividend-1', subtype: 'ORDINARY' };
const regularDividendReport = reconcile([regularDividend], { amountTolerance: 0.01 });
assert.equal(regularDividendReport.totals.proposals, 1);
assert.equal(regularDividendReport.totals.proposedWithdrawal, 250);

console.log('in-kind dividend is not treated as a cash dividend');

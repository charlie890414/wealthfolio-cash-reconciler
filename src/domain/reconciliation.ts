export type ActivityKind = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL';

export type ReconciliationStatus =
  | 'matched'
  | 'covered'
  | 'missing'
  | 'partial'
  | 'stale'
  | 'orphan'
  | 'excess';

export interface ReconciliationActivity {
  id: string;
  accountId: string;
  accountName: string;
  activityType: string;
  subtype?: string | null;
  date: Date | string;
  symbol?: string | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  amount?: string | number | null;
  fee?: string | number | null;
  tax?: string | number | null;
  currency: string;
  comment?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReconciliationPolicy {
  amountTolerance: number;
  startDate?: string;
  endDate?: string;
}

export interface TradeExpectation {
  activityId: string;
  activityType: 'BUY' | 'SELL' | 'DIVIDEND';
  expectedActivityType: 'DEPOSIT' | 'WITHDRAWAL';
  expectedAmount: number;
  grossAmount: number;
  fee: number;
  tax: number;
  date: string;
  symbol: string;
  accountId: string;
  accountName: string;
  currency: string;
}

export interface CashProposal {
  proposalId: string;
  accountId: string;
  accountName: string;
  activityType: 'DEPOSIT' | 'WITHDRAWAL';
  activityDate: string;
  amount: number;
  currency: string;
  comment: string;
  metadata: Record<string, unknown>;
  relatedActivityId: string;
  status: 'missing' | 'partial';
}

export function toCashActivityCreate(proposal: CashProposal) {
  return {
    accountId: proposal.accountId,
    activityType: proposal.activityType,
    activityDate: proposal.activityDate,
    amount: proposal.amount,
    currency: proposal.currency,
    comment: proposal.comment,
    metadata: JSON.stringify(proposal.metadata),
  };
}

export interface TradeReconciliation {
  expectation: TradeExpectation;
  status: ReconciliationStatus;
  matchedCashActivityId?: string;
  matchedAmount: number;
  proposal?: CashProposal;
  note?: string;
}

export interface ReconciliationDay {
  key: string;
  date: string;
  accountId: string;
  accountName: string;
  currency: string;
  trades: TradeReconciliation[];
  cashActivities: ReconciliationActivity[];
  expectedDeposit: number;
  expectedWithdrawal: number;
  existingDeposit: number;
  existingWithdrawal: number;
  missingDeposit: number;
  missingWithdrawal: number;
  status: 'balanced' | 'missing' | 'partial' | 'stale' | 'excess';
}

export interface ReconciliationReport {
  days: ReconciliationDay[];
  orphanCashActivities: ReconciliationActivity[];
  generatedAt: string;
  totals: {
    days: number;
    balancedDays: number;
    missingTrades: number;
    proposals: number;
    proposedDeposit: number;
    proposedWithdrawal: number;
    orphanActivities: number;
  };
}

const GENERATED_BY = 'tw-cash-reconciler';

function asNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string' || value.trim() === '') return 0;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function dateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isInDateRange(key: string, policy: ReconciliationPolicy): boolean {
  return (!policy.startDate || key >= policy.startDate) && (!policy.endDate || key <= policy.endDate);
}

function expectationFor(activity: ReconciliationActivity): TradeExpectation | null {
  if (activity.activityType !== 'BUY' && activity.activityType !== 'SELL' && activity.activityType !== 'DIVIDEND') return null;
  if (activity.activityType === 'DIVIDEND' && activity.subtype === 'DIVIDEND_IN_KIND') return null;

  const quantity = asNumber(activity.quantity);
  const unitPrice = asNumber(activity.unitPrice);
  const grossAmount = asNumber(activity.amount) || quantity * unitPrice;
  const fee = asNumber(activity.fee);
  const tax = asNumber(activity.tax);
  const expectedAmount = roundMoney(
    activity.activityType === 'BUY' ? grossAmount + fee + tax : grossAmount - fee - tax,
  );

  return {
    activityId: activity.id,
    activityType: activity.activityType,
    expectedActivityType: activity.activityType === 'BUY' ? 'DEPOSIT' : 'WITHDRAWAL',
    expectedAmount: Math.max(0, expectedAmount),
    grossAmount: roundMoney(grossAmount),
    fee: roundMoney(fee),
    tax: roundMoney(tax),
    date: dateKey(activity.date),
    symbol: activity.symbol || '現金交易',
    accountId: activity.accountId,
    accountName: activity.accountName,
    currency: activity.currency,
  };
}

function generatedRelation(activity: ReconciliationActivity): string | undefined {
  if (activity.metadata?.generatedBy !== GENERATED_BY) return undefined;
  const relatedId = activity.metadata.relatedActivityId;
  return typeof relatedId === 'string' ? relatedId : undefined;
}

function proposalFor(expectation: TradeExpectation, amount: number, status: 'missing' | 'partial'): CashProposal {
  const roundedAmount = roundMoney(amount);
  const label = expectation.activityType === 'DIVIDEND' ? '股息' : expectation.activityType;
  const direction = expectation.activityType === 'BUY' ? '入金' : expectation.activityType === 'DIVIDEND' ? '轉出' : '出金';
  return {
    proposalId: `${expectation.activityId}:${expectation.expectedActivityType}:${roundedAmount}`,
    accountId: expectation.accountId,
    accountName: expectation.accountName,
    activityType: expectation.expectedActivityType,
    activityDate: expectation.date,
    amount: roundedAmount,
    currency: expectation.currency,
    comment: `自動建立：${label} ${expectation.symbol} ${expectation.date} 的${direction}`,
    metadata: {
      generatedBy: GENERATED_BY,
      schemaVersion: 1,
      relatedActivityId: expectation.activityId,
      relatedActivityType: expectation.activityType,
    },
    relatedActivityId: expectation.activityId,
    status,
  };
}

function sameAmount(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function groupKey(activity: Pick<ReconciliationActivity, 'accountId' | 'currency'>, key: string): string {
  return `${activity.accountId}|${activity.currency}|${key}`;
}

function bucketKey(accountId: string, currency: string, key: string): string {
  return `${accountId}|${currency}|${key}`;
}

function withoutInternalTradePairs(
  expectations: TradeExpectation[],
  amountTolerance: number,
): TradeExpectation[] {
  const candidates: { buyIndex: number; sellIndex: number; difference: number }[] = [];
  const pairTolerance = amountTolerance * 2;

  for (let buyIndex = 0; buyIndex < expectations.length; buyIndex += 1) {
    if (expectations[buyIndex].activityType !== 'BUY') continue;
    for (let sellIndex = 0; sellIndex < expectations.length; sellIndex += 1) {
      if (expectations[sellIndex].activityType !== 'SELL') continue;
      const difference = Math.abs(
        expectations[buyIndex].expectedAmount - expectations[sellIndex].expectedAmount,
      );
      if (difference <= pairTolerance) candidates.push({ buyIndex, sellIndex, difference });
    }
  }

  candidates.sort((left, right) => left.difference - right.difference);
  const pairedIndexes = new Set<number>();
  for (const candidate of candidates) {
    if (pairedIndexes.has(candidate.buyIndex) || pairedIndexes.has(candidate.sellIndex)) continue;
    pairedIndexes.add(candidate.buyIndex);
    pairedIndexes.add(candidate.sellIndex);
  }

  return expectations.filter((_, index) => !pairedIndexes.has(index));
}

function buildDay(
  key: string,
  accountId: string,
  accountName: string,
  currency: string,
  expectations: TradeExpectation[],
  cashActivities: ReconciliationActivity[],
  policy: ReconciliationPolicy,
): ReconciliationDay {
  const generatedByTrade = new Map<string, ReconciliationActivity>();
  const unlinkedCash: ReconciliationActivity[] = [];
  for (const cash of cashActivities) {
    const relatedId = generatedRelation(cash);
    if (relatedId) generatedByTrade.set(relatedId, cash);
    else unlinkedCash.push(cash);
  }

  const usedCashIds = new Set<string>();
  const trades: TradeReconciliation[] = [];

  for (const expectation of expectations) {
    const generated = generatedByTrade.get(expectation.activityId);
    if (generated) {
      const existingAmount = asNumber(generated.amount);
      if (sameAmount(existingAmount, expectation.expectedAmount, policy.amountTolerance)) {
        usedCashIds.add(generated.id);
        trades.push({
          expectation,
          status: 'matched',
          matchedCashActivityId: generated.id,
          matchedAmount: existingAmount,
        });
      } else {
        trades.push({
          expectation,
          status: 'stale',
          matchedCashActivityId: generated.id,
          matchedAmount: existingAmount,
          note: `已建立的資金 activity 為 ${existingAmount}，目前預期為 ${expectation.expectedAmount}`,
        });
      }
      continue;
    }

    trades.push({ expectation, status: 'missing', matchedAmount: 0 });
  }

  for (const trade of trades.filter((item) => item.status === 'missing')) {
    const candidate = unlinkedCash.find(
      (cash) =>
        !usedCashIds.has(cash.id) &&
        cash.activityType === trade.expectation.expectedActivityType &&
        sameAmount(asNumber(cash.amount), trade.expectation.expectedAmount, policy.amountTolerance),
    );
    if (candidate) {
      usedCashIds.add(candidate.id);
      trade.status = 'covered';
      trade.matchedCashActivityId = candidate.id;
      trade.matchedAmount = asNumber(candidate.amount);
      trade.note = '已有相同金額的資金 activity，但尚未由本 addon 建立關聯。';
    }
  }

  const stillMissing = trades.filter((item) => item.status === 'missing');
  const availableByType = new Map<'DEPOSIT' | 'WITHDRAWAL', number>([
    ['DEPOSIT', 0],
    ['WITHDRAWAL', 0],
  ]);
  for (const cash of unlinkedCash) {
    if (!usedCashIds.has(cash.id) && (cash.activityType === 'DEPOSIT' || cash.activityType === 'WITHDRAWAL')) {
      availableByType.set(cash.activityType, (availableByType.get(cash.activityType) || 0) + asNumber(cash.amount));
    }
  }

  for (const trade of stillMissing) {
    const type = trade.expectation.expectedActivityType;
    const available = availableByType.get(type) || 0;
    const remaining = roundMoney(trade.expectation.expectedAmount - available);
    if (remaining <= policy.amountTolerance) {
      trade.status = 'covered';
      trade.matchedAmount = trade.expectation.expectedAmount;
      trade.note = '由同日彙總的既有資金 activity 覆蓋。';
      availableByType.set(type, roundMoney(Math.max(0, available - trade.expectation.expectedAmount)));
    } else if (available > policy.amountTolerance) {
      trade.status = 'partial';
      trade.matchedAmount = available;
      trade.proposal = proposalFor(trade.expectation, remaining, 'partial');
      availableByType.set(type, 0);
    } else {
      trade.proposal = proposalFor(trade.expectation, trade.expectation.expectedAmount, 'missing');
      availableByType.set(type, 0);
    }
  }

  const expectedDeposit = roundMoney(
    expectations.filter((item) => item.expectedActivityType === 'DEPOSIT').reduce((sum, item) => sum + item.expectedAmount, 0),
  );
  const expectedWithdrawal = roundMoney(
    expectations.filter((item) => item.expectedActivityType === 'WITHDRAWAL').reduce((sum, item) => sum + item.expectedAmount, 0),
  );
  const existingDeposit = roundMoney(
    cashActivities.filter((item) => item.activityType === 'DEPOSIT').reduce((sum, item) => sum + asNumber(item.amount), 0),
  );
  const existingWithdrawal = roundMoney(
    cashActivities.filter((item) => item.activityType === 'WITHDRAWAL').reduce((sum, item) => sum + asNumber(item.amount), 0),
  );
  const missingDeposit = roundMoney(Math.max(0, expectedDeposit - existingDeposit));
  const missingWithdrawal = roundMoney(Math.max(0, expectedWithdrawal - existingWithdrawal));
  const hasStale = trades.some((item) => item.status === 'stale');
  const hasExcess = existingDeposit > expectedDeposit + policy.amountTolerance || existingWithdrawal > expectedWithdrawal + policy.amountTolerance;
  const status = hasStale ? 'stale' : hasExcess ? 'excess' : trades.some((item) => item.status === 'partial') ? 'partial' : trades.some((item) => item.proposal) ? 'missing' : 'balanced';

  return {
    key: bucketKey(accountId, currency, key),
    date: key,
    accountId,
    accountName,
    currency,
    trades,
    cashActivities,
    expectedDeposit,
    expectedWithdrawal,
    existingDeposit,
    existingWithdrawal,
    missingDeposit,
    missingWithdrawal,
    status,
  };
}

export function reconcile(
  activities: ReconciliationActivity[],
  policy: ReconciliationPolicy = { amountTolerance: 1 },
): ReconciliationReport {
  const tradesByGroup = new Map<string, { key: string; activity: ReconciliationActivity; expectation: TradeExpectation }[]>();
  const cashByGroup = new Map<string, ReconciliationActivity[]>();
  const allTradeIds = new Set<string>();

  for (const activity of activities) {
    const key = dateKey(activity.date);
    if (activity.activityType === 'BUY' || activity.activityType === 'SELL' || activity.activityType === 'DIVIDEND') {
      const expectation = expectationFor(activity);
      if (!expectation) continue;
      allTradeIds.add(activity.id);
      if (!isInDateRange(key, policy)) continue;
      const bucket = groupKey(activity, key);
      const current = tradesByGroup.get(bucket) || [];
      current.push({ key, activity, expectation });
      tradesByGroup.set(bucket, current);
    } else if (activity.activityType === 'DEPOSIT' || activity.activityType === 'WITHDRAWAL') {
      const bucket = groupKey(activity, key);
      const current = cashByGroup.get(bucket) || [];
      current.push(activity);
      cashByGroup.set(bucket, current);
    }
  }

  const days = Array.from(tradesByGroup.entries())
    .flatMap(([bucket, items]) => {
      const [accountId, currency, key] = bucket.split('|');
      const expectations = withoutInternalTradePairs(
        items.map((item) => item.expectation),
        policy.amountTolerance,
      );
      if (expectations.length === 0) return [];
      const day = buildDay(
        key,
        accountId,
        items[0].activity.accountName,
        currency,
        expectations,
        cashByGroup.get(bucket) || [],
        policy,
      );
      return [day];
    })
    .sort((left, right) => right.date.localeCompare(left.date));

  const orphanCashActivities = activities.filter((activity) => {
    const relatedId = generatedRelation(activity);
    return Boolean(relatedId && !allTradeIds.has(relatedId));
  });
  for (const orphan of orphanCashActivities) {
    const bucket = days.find((day) => day.key === groupKey(orphan, dateKey(orphan.date)));
    if (bucket) bucket.status = 'excess';
  }

  const proposals = days.flatMap((day) => day.trades.flatMap((trade) => (trade.proposal ? [trade.proposal] : [])));
  return {
    days,
    orphanCashActivities,
    generatedAt: new Date().toISOString(),
    totals: {
      days: days.length,
      balancedDays: days.filter((day) => day.status === 'balanced').length,
      missingTrades: days.reduce((sum, day) => sum + day.trades.filter((trade) => trade.status === 'missing' || trade.status === 'partial').length, 0),
      proposals: proposals.length,
      proposedDeposit: roundMoney(proposals.filter((proposal) => proposal.activityType === 'DEPOSIT').reduce((sum, proposal) => sum + proposal.amount, 0)),
      proposedWithdrawal: roundMoney(proposals.filter((proposal) => proposal.activityType === 'WITHDRAWAL').reduce((sum, proposal) => sum + proposal.amount, 0)),
      orphanActivities: orphanCashActivities.length,
    },
  };
}

export function toReconciliationActivity(activity: {
  id: string;
  activityType: string;
  subtype?: string | null;
  date: Date;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  fee: string | null;
  tax?: string | null;
  currency: string;
  comment?: string;
  accountId: string;
  accountName: string;
  assetSymbol: string;
  metadata?: Record<string, unknown>;
}): ReconciliationActivity {
  return {
    id: activity.id,
    accountId: activity.accountId,
    accountName: activity.accountName,
    activityType: activity.activityType,
    subtype: activity.subtype,
    date: activity.date,
    symbol: activity.assetSymbol,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    tax: activity.tax,
    currency: activity.currency,
    comment: activity.comment,
    metadata: activity.metadata,
  };
}

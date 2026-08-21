import type { AddonContext, Account, ActivityDetails } from '@wealthfolio/addon-sdk';
import {
  type CashProposal,
  type ReconciliationActivity,
  toCashActivityCreate,
  toReconciliationActivity,
} from '../domain/reconciliation';

export interface AccountOption {
  id: string;
  name: string;
  currency: string;
  accountType: string;
  trackingMode: string;
}

export function toAccountOption(account: Account): AccountOption {
  return {
    id: account.id,
    name: account.name,
    currency: account.currency,
    accountType: account.accountType,
    trackingMode: account.trackingMode,
  };
}

export async function loadAccounts(ctx: AddonContext): Promise<AccountOption[]> {
  const accounts = await ctx.api.accounts.getAll();
  return accounts
    .filter((account) => account.isActive && !account.isArchived)
    .map(toAccountOption)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadActivities(ctx: AddonContext, accountId?: string): Promise<ReconciliationActivity[]> {
  const activities = await ctx.api.activities.getAll(accountId);
  return activities.map((activity: ActivityDetails) =>
    toReconciliationActivity({
      id: activity.id,
      activityType: activity.activityType,
      subtype: activity.subtype,
      date: activity.date,
      quantity: activity.quantity,
      unitPrice: activity.unitPrice,
      amount: activity.amount,
      fee: activity.fee,
      tax: activity.tax,
      currency: activity.currency,
      comment: activity.comment,
      accountId: activity.accountId,
      accountName: activity.accountName,
      assetSymbol: activity.assetSymbol,
      metadata: activity.metadata,
    }),
  );
}

export async function createCashActivities(ctx: AddonContext, proposals: CashProposal[]): Promise<void> {
  if (proposals.length === 0) return;
  const result = await ctx.api.activities.saveMany({
    creates: proposals.map(toCashActivityCreate),
    updates: [],
    deleteIds: [],
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.message).join('; '));
  }
}

export function refreshHostData(ctx: AddonContext): void {
  ctx.api.query.invalidateQueries('activities');
  ctx.api.query.invalidateQueries('accounts');
}

import type { AddonContext } from '@wealthfolio/addon-sdk';

const PREFERENCES_KEY = 'preferences';

export interface ReconciliationPreferences {
  accountId?: string;
  startDate?: string;
  endDate?: string;
  amountTolerance?: number;
}

export async function loadPreferences(ctx: AddonContext): Promise<ReconciliationPreferences> {
  const raw = await ctx.api.storage.get(PREFERENCES_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as ReconciliationPreferences : {};
  } catch {
    return {};
  }
}

export async function savePreferences(ctx: AddonContext, preferences: ReconciliationPreferences): Promise<void> {
  await ctx.api.storage.set(PREFERENCES_KEY, JSON.stringify(preferences));
}

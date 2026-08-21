import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import { Card, CardContent } from '@wealthfolio/ui';
import {
  type AccountOption,
  createCashActivities,
  loadAccounts,
  loadActivities,
  refreshHostData,
} from '../lib/wealthfolio';
import { loadPreferences, savePreferences } from '../lib/storage';
import {
  type CashProposal,
  reconcile,
  type ReconciliationPolicy,
  type ReconciliationReport,
  type ReconciliationStatus,
} from '../domain/reconciliation';

interface ReconciliationPageProps {
  ctx: AddonContext;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function oneYearAgo(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

function statusLabel(status: ReconciliationStatus | ReconciliationReport['days'][number]['status']): string {
  const labels: Record<string, string> = {
    matched: '已配對',
    covered: '已有彙總資金',
    missing: '缺少',
    partial: '部分缺少',
    stale: '金額已變更',
    orphan: '孤兒資金 activity',
    excess: '資金較多',
    balanced: '已平衡',
  };
  return labels[status] || status;
}

function statusClass(status: string): string {
  if (status === 'balanced' || status === 'matched' || status === 'covered') return 'text-emerald-600';
  if (status === 'stale' || status === 'excess') return 'text-amber-600';
  return 'text-red-600';
}

function proposalKey(proposal: CashProposal): string {
  return proposal.proposalId;
}

export default function ReconciliationPage({ ctx }: ReconciliationPageProps) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState('');
  const [startDate, setStartDate] = useState(oneYearAgo);
  const [endDate, setEndDate] = useState(today);
  const [tolerance, setTolerance] = useState('1');
  const [activities, setActivities] = useState<Awaited<ReturnType<typeof loadActivities>>>([]);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  const selectedAccount = useMemo(() => accounts.find((account) => account.id === accountId), [accounts, accountId]);
  const policy = useMemo<ReconciliationPolicy>(() => ({
    startDate,
    endDate,
    amountTolerance: Math.max(0, Number(tolerance) || 0),
  }), [endDate, startDate, tolerance]);

  const updateReport = useCallback((loaded: Awaited<ReturnType<typeof loadActivities>>) => {
    const nextReport = reconcile(loaded, policy);
    setActivities(loaded);
    setReport(nextReport);
    setSelected(new Set(nextReport.days.flatMap((day) => day.trades.flatMap((trade) => (trade.proposal ? [proposalKey(trade.proposal)] : [])))));
  }, [policy]);

  const scan = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadActivities(ctx, accountId);
      updateReport(loaded);
      setConfirmingCreate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '讀取 Wealthfolio 資料失敗');
    } finally {
      setLoading(false);
    }
  }, [accountId, ctx, updateReport]);

  useEffect(() => {
    void Promise.all([loadAccounts(ctx), loadPreferences(ctx)])
      .then(([loaded, preferences]) => {
        setAccounts(loaded);
        setAccountId(preferences.accountId || loaded[0]?.id || '');
        if (preferences.startDate) setStartDate(preferences.startDate);
        if (preferences.endDate) setEndDate(preferences.endDate);
        if (typeof preferences.amountTolerance === 'number') setTolerance(String(preferences.amountTolerance));
        setPreferencesLoaded(true);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '讀取帳戶或偏好設定失敗'))
      .finally(() => setLoading(false));
  }, [ctx]);

  useEffect(() => {
    if (!preferencesLoaded || !accountId) return;
    void savePreferences(ctx, {
      accountId,
      startDate,
      endDate,
      amountTolerance: Math.max(0, Number(tolerance) || 0),
    }).catch(() => undefined);
  }, [accountId, ctx, endDate, preferencesLoaded, startDate, tolerance]);

  useEffect(() => {
    if (accountId) void scan();
  }, [accountId]);

  useEffect(() => {
    if (!preferencesLoaded || !accountId || loading) return;
    const nextReport = reconcile(activities, policy);
    setReport(nextReport);
    setSelected(new Set(nextReport.days.flatMap((day) => day.trades.flatMap((trade) => (trade.proposal ? [proposalKey(trade.proposal)] : [])))));
  }, [accountId, activities, loading, policy, preferencesLoaded]);

  const proposals = report?.days.flatMap((day) => day.trades.flatMap((trade) => (trade.proposal ? [trade.proposal] : []))) || [];
  const selectedProposals = proposals.filter((proposal) => selected.has(proposalKey(proposal)));

  const toggleProposal = (proposal: CashProposal) => {
    setSelected((current) => {
      const next = new Set(current);
      const key = proposalKey(proposal);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const requestCreateSelected = () => {
    if (selectedProposals.length === 0) return;
    setConfirmingCreate(true);
  };

  const createSelected = async () => {
    if (selectedProposals.length === 0) {
      setConfirmingCreate(false);
      return;
    }
    setConfirmingCreate(false);
    setSaving(true);
    setError(null);
    try {
      // Re-read immediately before writing so an old scan cannot create duplicates.
      const latest = await loadActivities(ctx, accountId);
      const latestReport = reconcile(latest, policy);
      const latestProposals = latestReport.days
        .flatMap((day) => day.trades.flatMap((trade) => (trade.proposal ? [trade.proposal] : [])))
        .filter((proposal) => selected.has(proposalKey(proposal)));
      await createCashActivities(ctx, latestProposals);
      refreshHostData(ctx);
      await scan();
      ctx.api.toast.success(`已新增 ${latestProposals.length} 筆資金 activity`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '新增資金 activity 失敗';
      setError(message);
      ctx.api.toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">交割現金對帳</h1>
        <p className="text-muted-foreground mt-1">按成交日檢查 BUY／SELL／DIVIDEND 是否有對應的 DEPOSIT／WITHDRAWAL。</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-5 items-end">
            <label className="text-sm">
              <span className="block mb-1 font-medium">證券帳戶</span>
              <select className="w-full rounded border px-2 py-2 bg-background" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block mb-1 font-medium">開始日期</span>
              <input className="w-full rounded border px-2 py-2 bg-background" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block mb-1 font-medium">結束日期</span>
              <input className="w-full rounded border px-2 py-2 bg-background" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block mb-1 font-medium">金額容差</span>
              <input className="w-full rounded border px-2 py-2 bg-background" type="number" min="0" step="0.01" value={tolerance} onChange={(event) => setTolerance(event.target.value)} />
            </label>
            <button className="rounded bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50" disabled={!accountId || loading} onClick={() => void scan()}>
              {loading ? '掃描中…' : '重新掃描'}
            </button>
          </div>
          {selectedAccount && selectedAccount.trackingMode !== 'TRANSACTIONS' && (
            <p className="text-amber-600 text-sm mt-3">目前帳戶不是 Transactions mode；此 addon 主要針對交易明細帳戶。</p>
          )}
        </CardContent>
      </Card>

      {error && <div className="rounded border border-red-300 bg-red-50 text-red-700 px-4 py-3">{error}</div>}

      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Summary label="日期 bucket" value={String(report.totals.days)} />
            <Summary label="已平衡" value={String(report.totals.balancedDays)} />
            <Summary label="待新增" value={`${report.totals.proposals} 筆`} />
            <Summary label="待新增金額" value={`${money(report.totals.proposedDeposit, selectedAccount?.currency || 'TWD')} 入 / ${money(report.totals.proposedWithdrawal, selectedAccount?.currency || 'TWD')} 出`} />
          </div>

          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">每日檢查結果</h2>
                  <p className="text-sm text-muted-foreground">畫面按日彙總，建立時仍會逐筆產生並在 comment 標示來源。</p>
                </div>
                <button className="rounded bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50" disabled={saving || confirmingCreate || selectedProposals.length === 0} onClick={requestCreateSelected}>
                  {saving ? '新增中…' : `新增選取的 ${selectedProposals.length} 筆`}
                </button>
              </div>

              {confirmingCreate && (
                <div role="dialog" aria-label="確認新增資金 activity" className="rounded border border-primary/40 bg-primary/5 p-3 space-y-3">
                  <p className="font-medium">確定新增以下 {selectedProposals.length} 筆資金 activity？</p>
                  <ul className="text-sm list-disc pl-5">
                    {selectedProposals.map((proposal) => (
                      <li key={proposalKey(proposal)}>{proposal.activityDate} {proposal.activityType} {money(proposal.amount, proposal.currency)}</li>
                    ))}
                  </ul>
                  <div className="flex gap-2 justify-end">
                    <button className="rounded border px-3 py-2" onClick={() => setConfirmingCreate(false)}>取消</button>
                    <button className="rounded bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50" disabled={saving} onClick={() => void createSelected()}>確認新增</button>
                  </div>
                </div>
              )}

              {report.days.length === 0 && <p className="text-sm text-muted-foreground">指定範圍內沒有 BUY／SELL。</p>}
              {report.days.map((day) => (
                <details key={day.key} open={day.status !== 'balanced'} className="rounded border p-3">
                  <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{day.date} · {day.accountName} · {day.currency}</span>
                    <span className={`${statusClass(day.status)} font-medium`}>{statusLabel(day.status)}</span>
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b text-left"><th className="py-2 pr-3">新增</th><th className="py-2 pr-3">交易</th><th className="py-2 pr-3">預期金額</th><th className="py-2 pr-3">狀態</th><th className="py-2">說明</th></tr></thead>
                      <tbody>
                        {day.trades.map((trade) => (
                          <tr key={trade.expectation.activityId} className="border-b last:border-0">
                            <td className="py-2 pr-3">{trade.proposal ? <input type="checkbox" disabled={confirmingCreate || saving} checked={selected.has(proposalKey(trade.proposal))} onChange={() => toggleProposal(trade.proposal!)} /> : '—'}</td>
                            <td className="py-2 pr-3">{trade.expectation.activityType} {trade.expectation.symbol}<br /><span className="text-xs text-muted-foreground">{trade.expectation.activityId}</span></td>
                            <td className="py-2 pr-3">{money(trade.expectation.expectedAmount, day.currency)}</td>
                            <td className={`py-2 pr-3 ${statusClass(trade.status)}`}>{statusLabel(trade.status)}</td>
                            <td className="py-2">{trade.proposal ? `${trade.proposal.activityType} ${money(trade.proposal.amount, day.currency)} · ${trade.proposal.comment}` : trade.note || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4 mt-3 text-sm">
                    <span>預期入金：{money(day.expectedDeposit, day.currency)}</span>
                    <span>既有入金：{money(day.existingDeposit, day.currency)}</span>
                    <span>預期出金：{money(day.expectedWithdrawal, day.currency)}</span>
                    <span>既有出金：{money(day.existingWithdrawal, day.currency)}</span>
                  </div>
                </details>
              ))}

              {report.orphanCashActivities.length > 0 && (
                <p className="text-sm text-amber-600">發現 {report.orphanCashActivities.length} 筆由本 addon 建立、但找不到原始交易的資金 activity；未自動刪除。</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground">已載入 {activities.length} 筆 activity。資料只在你開啟頁面或按下重新掃描時重新載入；日期與容差變更會即時重新計算，不會背景自動寫入。</p>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold mt-1">{value}</div></CardContent></Card>;
}

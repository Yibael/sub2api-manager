import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { CreditCard, Pin, PinOff } from 'lucide-react'
import { toast } from 'sonner'
import { useMonitor } from '@/lib/monitor'
import { useWorkspace } from '@/lib/preferences'
import { BackButton, ErrorNotice, Money, PageHeading, ProviderMark, QuotaList, RefreshButton } from '@/components/common'
import { DetailSkeleton, LoadingValue, StableRegion } from '@/components/loading'
import { AccountBadges, AccountStatusBadges } from '@/components/account-badges'
import { SubscriptionEditor } from '@/components/subscription-editor'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function DetailPage() {
  const { id: rawId } = useParams({ from: '/accounts/$id' }), id = Number(rawId)
  const valid = Number.isSafeInteger(id) && id > 0
  const monitor = useMonitor(valid ? [id] : [])
  const { preferences, update } = useWorkspace(), [editing, setEditing] = useState(false)
  const sample = monitor.status.data?.[id], account = sample?.data
  const today = monitor.today.data?.items[id], usage = monitor.quota.data?.[id], spending = monitor.spending.data?.rows[0]
  const consumption = monitor.dailySpending.data?.items[id]
  const subscription = preferences.subscriptions.find(s => s.accountId === id)
  const weeklyEstimate = account?.platform === 'openai' && account.type === 'oauth' ? usage?.data?.estimatedWeeklyCost ?? null : undefined
  const pending = !account && !sample?.error && !monitor.status.error && valid
  const todayPending = !today?.data && !today?.error && !monitor.today.error
  const spendingPending = !!subscription && !spending && !monitor.spending.error
  return <div className="page-stack">
    <div><BackButton fallback="/accounts" /></div>
    <PageHeading title={account?.name ?? `账号 #${rawId}`} action={<RefreshButton countdown={monitor.nextRefreshIn} busy={pending || monitor.refreshing || monitor.quota.isFetching} onClick={() => void monitor.refresh()} />} />
    <ErrorNotice message={!valid ? '账号 ID 无效' : monitor.status.error?.message ?? sample?.error ?? monitor.today.error?.message ?? today?.error ?? monitor.quota.error?.message ?? usage?.error} />
    <StableRegion phase={pending ? 'pending' : 'ready'} busy={monitor.isFetching} contentClassName="page-stack">
      {!account ? pending ? <DetailSkeleton /> : <p className="text-sm text-muted-foreground">暂无账号详情</p> : <>
        <Card><CardHeader className="gap-3"><div className="flex min-w-0 items-center gap-3"><ProviderMark platform={account.platform} /><CardTitle>运行状态</CardTitle></div><CardAction className="row-span-1 self-center"><AccountStatusBadges account={account} now={monitor.now} stale={!!sample?.error || !!monitor.status.error} /></CardAction><CardDescription className="col-span-2"><AccountBadges account={account} showId /></CardDescription></CardHeader><CardContent>
          <div className="detail-metrics"><div><p>当前并发 / 上限</p><strong>{account.currentConcurrency ?? '—'} / {account.concurrency ?? '—'}</strong></div><div><p>今日请求</p><strong><LoadingValue loading={todayPending}>{today?.data?.requests?.toLocaleString() ?? '—'}</LoadingValue></strong></div><div><p>今日 Token</p><strong><LoadingValue loading={todayPending}>{today?.data?.tokens?.toLocaleString() ?? '—'}</LoadingValue></strong></div></div>
          <div className="mt-5"><Button variant={preferences.pins.includes(id) ? 'secondary' : 'default'} onClick={() => { if (!preferences.pins.includes(id) && preferences.pins.length >= 100) { toast.error('最多关注 100 个账号'); return } update({ pins: preferences.pins.includes(id) ? preferences.pins.filter(p => p !== id) : [...preferences.pins, id] }) }}>{preferences.pins.includes(id) ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}{preferences.pins.includes(id) ? '取消关注' : '关注账号'}</Button></div>
        </CardContent></Card>
        <div className="detail-grid">
          <Card><CardHeader><CardTitle>额度</CardTitle></CardHeader><CardContent><QuotaList quotas={account.supportsUsage ? usage?.data?.windows ?? [] : account.localQuotas} pending={account.supportsUsage && !usage?.data && !usage?.error && !monitor.quota.error} empty={account.supportsUsage ? '暂无可用额度数据' : '未配置额度'} now={monitor.now} estimatedCost={weeklyEstimate} /></CardContent></Card>
          <Card><CardHeader><CardTitle>今日</CardTitle></CardHeader><CardContent><dl className="data-list"><div><dt>今日标准用量</dt><dd><Money value={today?.data?.standardCost} loading={todayPending} /></dd></div><div><dt>今日消费</dt><dd><Money value={consumption?.error ? null : consumption?.data} currency={preferences.actualCurrency} loading={!consumption && !monitor.dailySpending.error} /></dd></div></dl><ErrorNotice message={consumption?.error ?? monitor.dailySpending.error?.message} /></CardContent></Card>
        </div>
        {account.type === 'oauth' && <Card><CardHeader><CardTitle>周期</CardTitle><CardDescription className="min-h-5"><LoadingValue loading={spendingPending}>{spending ? `${spending.cycle.start} — ${spending.cycle.end}` : null}</LoadingValue></CardDescription><CardAction><Button variant="outline" onClick={() => setEditing(true)}><CreditCard data-icon="inline-start" />编辑订阅</Button></CardAction></CardHeader><CardContent><dl className="data-list"><div><dt>成本</dt><dd><Money value={subscription?.price} currency={preferences.costCurrency} /></dd></div><div><dt>周期消费</dt><dd><Money value={spending?.spending.data} currency={preferences.actualCurrency} loading={spendingPending} /></dd></div></dl><ErrorNotice message={spending?.spending.error ?? monitor.spending.error?.message} /></CardContent></Card>}
      </>}
    </StableRegion>
    {editing && account && <SubscriptionEditor account={account} onClose={() => setEditing(false)} />}
  </div>
}

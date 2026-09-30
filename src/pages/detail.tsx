import { useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, CreditCard, Pin, PinOff } from 'lucide-react'
import { toast } from 'sonner'
import { useMonitor } from '@/lib/monitor'
import { useWorkspace } from '@/lib/preferences'
import { ErrorNotice, Money, PageHeading, ProviderMark, QuotaRow, RefreshButton } from '@/components/common'
import { SubscriptionEditor } from '@/components/subscription-editor'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { accountState } from '../../shared/domain'

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
  return <div className="page-stack"><div><Button variant="ghost" asChild><Link to="/accounts"><ArrowLeft data-icon="inline-start" />返回账号</Link></Button></div><PageHeading title={account?.name ?? `账号 #${rawId}`} action={<RefreshButton countdown={monitor.nextRefreshIn} busy={monitor.isFetching} onClick={() => void monitor.refresh()} />} /><ErrorNotice message={!valid ? '账号 ID 无效' : monitor.status.error?.message ?? sample?.error ?? monitor.today.error?.message ?? today?.error ?? monitor.quota.error?.message ?? usage?.error} />{!account ? (sample?.error || monitor.status.error || !valid ? <p className="text-sm text-muted-foreground">暂无账号详情</p> : <Skeleton className="h-48 w-full" />) : <>
    <Card><CardHeader><div className="flex items-center gap-3"><ProviderMark platform={account.platform} /><div><CardTitle>运行状态</CardTitle><CardDescription>#{id} · {account.type}</CardDescription></div></div><CardAction><Badge variant="outline">{sample?.error ? '非实时' : accountState(account, monitor.now)}</Badge></CardAction></CardHeader><CardContent><div className="detail-metrics"><div><p>当前并发 / 上限</p><strong>{account.currentConcurrency ?? '—'} / {account.concurrency ?? '—'}</strong></div><div><p>今日请求</p><strong>{today?.data?.requests?.toLocaleString() ?? '—'}</strong></div><div><p>今日 Token</p><strong>{today?.data?.tokens?.toLocaleString() ?? '—'}</strong></div></div><div className="mt-5"><Button variant={preferences.pins.includes(id) ? 'secondary' : 'default'} onClick={() => { if (!preferences.pins.includes(id) && preferences.pins.length >= 100) { toast.error('最多关注 100 个账号'); return } update({ pins: preferences.pins.includes(id) ? preferences.pins.filter(p => p !== id) : [...preferences.pins, id] }) }}>{preferences.pins.includes(id) ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}{preferences.pins.includes(id) ? '取消关注' : '关注账号'}</Button></div></CardContent></Card>
    <div className="detail-grid"><Card><CardHeader><CardTitle>额度</CardTitle></CardHeader><CardContent className="flex flex-col gap-5">{(account.supportsUsage ? usage?.data?.windows ?? [] : account.localQuotas).map(q => <QuotaRow key={q.name} quota={q} now={monitor.now} estimatedCost={q.name === '7日额度' ? weeklyEstimate : undefined} />)}{!(account.supportsUsage ? usage?.data?.windows.length : account.localQuotas.length) && <p className="text-muted-foreground">{account.supportsUsage ? '暂无可用额度数据' : '未配置额度'}</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>今日</CardTitle></CardHeader><CardContent><dl className="data-list"><div><dt>今日标准用量</dt><dd><Money value={today?.data?.standardCost} /></dd></div><div><dt>今日消费</dt><dd><Money value={consumption?.error ? null : consumption?.data} currency={preferences.actualCurrency} /></dd></div></dl><ErrorNotice message={consumption?.error ?? monitor.dailySpending.error?.message} /></CardContent></Card></div>
    {account.type === 'oauth' && <Card><CardHeader><CardTitle>周期</CardTitle>{spending && <CardDescription>{spending.cycle.start} — {spending.cycle.end}</CardDescription>}<CardAction><Button variant="outline" onClick={() => setEditing(true)}><CreditCard data-icon="inline-start" />编辑订阅</Button></CardAction></CardHeader><CardContent><dl className="data-list"><div><dt>成本</dt><dd><Money value={subscription?.price} currency={preferences.costCurrency} /></dd></div><div><dt>周期消费</dt><dd><Money value={spending?.spending.data} currency={preferences.actualCurrency} /></dd></div></dl><ErrorNotice message={spending?.spending.error ?? monitor.spending.error?.message} /></CardContent></Card>}
    {editing && <SubscriptionEditor account={account} onClose={() => setEditing(false)} />}</>}</div>
}

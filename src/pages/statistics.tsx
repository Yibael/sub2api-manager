import { CalendarDays, Coins, Wallet } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { sumMoney } from '../../shared/money'
import { useMemo, useState } from 'react'
import { useWorkspace } from '@/lib/preferences'
import { useMonitor } from '@/lib/monitor'
import { useUserRankings } from '@/lib/rankings'
import { AccountBadges } from '@/components/account-badges'
import { UserRankingCard } from '@/components/user-ranking'
import { LoadingValue } from '@/components/loading'
import type { RankingRange } from '../../shared/domain'
import { ErrorNotice, Metric, Money, NoPins, PageHeading, RefreshButton } from '@/components/common'
import { spendingTotal } from './dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function StatisticsPage() {
  const { preferences } = useWorkspace(), monitor = useMonitor(undefined, true, 'statistics')
  const [range, setRange] = useState<RankingRange>('today')
  const rankings = useUserRankings(monitor.now, range), [refreshing, setRefreshing] = useState(false)
  const { period } = rankings
  const rangeLabel = range === 'hour' ? `${period.period} 至今` : period.startDate === period.endDate ? period.endDate : `${period.startDate} — ${period.endDate}`
  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try { await Promise.all([monitor.refresh(), rankings.forceRefresh()]) }
    finally { setRefreshing(false) }
  }
  const cost = useMemo(() => monitor.subscriptions.length ? sumMoney(monitor.subscriptions.map(subscription => subscription.price)) : null, [monitor.subscriptions])
  const spendingPending = monitor.subscriptions.length > 0 && !monitor.spending.data && !monitor.spending.error
  return <div className="page-stack"><PageHeading title="消费统计" action={<RefreshButton busy={refreshing} onClick={() => void refresh()} />} /><ErrorNotice message={monitor.spending.error?.message ?? monitor.status.error?.message} /><div className="metric-grid three"><Metric label="今日消费" value={<Money value={spendingTotal(monitor, 'today')} currency={preferences.actualCurrency} />} icon={<Wallet />} loading={spendingPending} /><Metric label="周期消费" value={<Money value={spendingTotal(monitor, 'spending')} currency={preferences.actualCurrency} />} icon={<Coins />} loading={spendingPending} /><Metric label="成本" value={<Money value={cost} currency={preferences.costCurrency} />} icon={<CalendarDays />} /></div>
    <p className="text-xs text-muted-foreground">消费汇总仅包含已关注且配置订阅的账号；消费榜统计全站用户。</p>
    <UserRankingCard title="消费榜" description={`${rangeLabel}${period.timeZone === preferences.timeZone ? '' : ` · ${period.timeZone}`}`} sample={rankings.data} error={rankings.error?.message} loading={rankings.isFetching} currency={preferences.actualCurrency} range={range} onRangeChange={setRange} />
    {!preferences.pins.length ? <NoPins /> : !monitor.subscriptions.length ? <Alert><AlertTitle>暂无订阅</AlertTitle><AlertDescription><Button variant="link" asChild><Link to="/accounts" replace>配置订阅</Link></Button></AlertDescription></Alert> : <Card><CardHeader><CardTitle>账号消费明细</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">{monitor.subscriptions.map(subscription => {
      const row = monitor.spending.data?.rows.find(row => row.accountId === subscription.accountId), account = monitor.status.data?.[subscription.accountId]?.data
      return <div className="spending-row" key={subscription.accountId}><div><Link className="account-name" aria-label={account?.name ?? `账号 #${subscription.accountId}`} to="/accounts/$id" params={{ id: String(subscription.accountId) }}><LoadingValue loading={!account && !monitor.status.error && !monitor.status.data?.[subscription.accountId]?.error}>{account?.name ?? `账号 #${subscription.accountId}`}</LoadingValue></Link>{account && <div className="mt-2"><AccountBadges account={account} /></div>}<p className="text-sm text-muted-foreground mt-2"><LoadingValue loading={spendingPending}>{row ? `${row.cycle.start} — ${row.cycle.end}` : '—'}</LoadingValue></p></div><div className="spending-values"><div><span>今日消费</span><strong><Money value={row?.today.data} currency={preferences.actualCurrency} loading={spendingPending} /></strong></div><div><span>周期消费</span><strong><Money value={row?.spending.data} currency={preferences.actualCurrency} loading={spendingPending} /></strong></div><div><span>成本</span><strong><Money value={subscription.price} currency={preferences.costCurrency} /></strong></div></div>{(row?.spending.error || row?.today.error) && <ErrorNotice message={row.spending.error ?? row.today.error} />}</div>
    })}</CardContent></Card>}
</div>
}

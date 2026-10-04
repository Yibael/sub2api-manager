import { CalendarDays, Coins, ShieldCheck, Wallet } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { sumMoney } from '../../shared/money'
import { rankingsIncludeAdmin } from '../../shared/preferences'
import { useMemo, useState } from 'react'
import { useWorkspace } from '@/lib/preferences'
import { useStatistics } from '@/lib/statistics'
import { useNearViewport } from '@/lib/near-viewport'
import { useUserRankings, useModelRankings } from '@/lib/rankings'
import { AccountBadges } from '@/components/account-badges'
import { UserRankingCard } from '@/components/user-ranking'
import { ModelRankingCard } from '@/components/model-ranking'
import { LoadingValue } from '@/components/loading'
import type { RankingRange, ModelRankingRange } from '../../shared/domain'
import { EmptyState, ErrorNotice, Metric, Money, NoPins, PageHeading, RefreshButton, SectionHeading } from '@/components/common'
import { spendingTotal } from './dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function StatisticsPage() {
  const { preferences } = useWorkspace()
  const { ref: subscriptionRef, near: subscriptionNear } = useNearViewport<HTMLElement>()
  const { ref: userRef, near: userNear } = useNearViewport<HTMLDivElement>()
  const { ref: modelRef, near: modelNear } = useNearViewport<HTMLDivElement>()
  const monitor = useStatistics(subscriptionNear)
  const [range, setRange] = useState<RankingRange>('today')
  const [modelRange, setModelRange] = useState<ModelRankingRange>('today')
  const rankings = useUserRankings(monitor.now, range, userNear)
  const models = useModelRankings(monitor.now, modelRange, modelNear)
  const { period } = rankings
  const rangeLabel = range === 'hour' ? `${period.period} 至今` : period.startDate === period.endDate ? period.endDate : `${period.startDate} — ${period.endDate}`
  const modelRangeLabel = models.period.startDate === models.period.endDate ? models.period.endDate : `${models.period.startDate} — ${models.period.endDate}`
  const cost = useMemo(() => monitor.subscriptions.length ? sumMoney(monitor.subscriptions.map(subscription => subscription.price)) : null, [monitor.subscriptions])
  const spendingPending = monitor.subscriptions.length > 0 && !monitor.spending.data && !monitor.spending.error
  return <div className="page-stack"><PageHeading title="统计" />
    <section className="page-section" aria-labelledby="global-statistics-heading">
      <SectionHeading id="global-statistics-heading" title="全站榜单" description="按实际消费排序"
        meta={<Badge variant="secondary"><ShieldCheck data-icon="inline-start" />{rankingsIncludeAdmin(preferences) ? '包含 Admin' : '已排除 Admin'}</Badge>} />
      <div ref={userRef}><UserRankingCard title="消费榜" description={`${rangeLabel}${period.timeZone === preferences.timeZone ? '' : ` · ${period.timeZone}`}`} sample={rankings.data} error={rankings.error?.message} loading={rankings.isFetching} currency={preferences.actualCurrency} range={range} onRangeChange={setRange} onRefresh={() => void rankings.forceRefresh()} /></div>
      <div ref={modelRef}><ModelRankingCard description={modelRangeLabel} sample={models.data} error={models.error?.message} loading={models.isFetching} currency={preferences.actualCurrency} range={modelRange} onRangeChange={setModelRange} onRefresh={() => void models.forceRefresh()} /></div>
    </section>
    <section ref={subscriptionRef} className="page-section" aria-labelledby="subscription-statistics-heading">
      <SectionHeading id="subscription-statistics-heading" title="订阅与成本" description="仅汇总已关注且配置订阅的账号"
        action={monitor.subscriptions.length > 0 && <RefreshButton mode="icon" label="刷新订阅与成本" busy={monitor.spending.isFetching} onClick={() => void monitor.spending.forceRefresh()} />} />
      <ErrorNotice message={monitor.spending.error?.message ?? monitor.status.error?.message} />
      <div className="metric-grid three"><Metric label="今日消费" value={<Money value={spendingTotal(monitor, 'today')} currency={preferences.actualCurrency} />} icon={<Wallet />} loading={spendingPending} /><Metric label="周期消费" value={<Money value={spendingTotal(monitor, 'spending')} currency={preferences.actualCurrency} />} icon={<Coins />} loading={spendingPending} /><Metric label="成本" value={<Money value={cost} currency={preferences.costCurrency} />} icon={<CalendarDays />} /></div>
    {!preferences.pins.length ? <NoPins /> : !monitor.subscriptions.length ? <EmptyState panel title="暂无订阅" description="配置订阅后查看周期消费与成本。" action={<Button variant="outline" asChild><Link to="/accounts" replace>配置订阅</Link></Button>} /> : <Card><CardHeader><CardTitle>账号消费明细</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">{monitor.subscriptions.map(subscription => {
      const row = monitor.spending.data?.rows.find(row => row.accountId === subscription.accountId), account = monitor.status.data?.[subscription.accountId]?.data
      return <div className="spending-row" key={subscription.accountId}><div><Link className="account-name" aria-label={account?.name ?? `账号 #${subscription.accountId}`} to="/accounts/$id" params={{ id: String(subscription.accountId) }}><LoadingValue loading={!account && !monitor.status.error && !monitor.status.data?.[subscription.accountId]?.error}>{account?.name ?? `账号 #${subscription.accountId}`}</LoadingValue></Link>{account && <div className="mt-2"><AccountBadges account={account} /></div>}<p className="content-meta mt-2"><LoadingValue loading={spendingPending}>{row ? `${row.cycle.start} — ${row.cycle.end}` : '—'}</LoadingValue></p></div><div className="spending-values"><div><span>今日消费</span><strong><Money value={row?.today.data} currency={preferences.actualCurrency} loading={spendingPending} /></strong></div><div><span>周期消费</span><strong><Money value={row?.spending.data} currency={preferences.actualCurrency} loading={spendingPending} /></strong></div><div><span>成本</span><strong><Money value={subscription.price} currency={preferences.costCurrency} /></strong></div></div>{(row?.spending.error || row?.today.error) && <ErrorNotice message={row.spending.error ?? row.today.error} />}</div>
    })}</CardContent></Card>}
    </section>
</div>
}

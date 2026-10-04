import { Activity, ArrowUpRight, ChartNoAxesCombined, Coins, Pin, Wallet } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { sumMoney } from '../../shared/money'
import { useMemo } from 'react'
import { useMonitor, type MonitorData } from '@/lib/monitor'
import { useWorkspace } from '@/lib/preferences'
import { AccountCard, ErrorNotice, Metric, Money, NoPins, PageHeading, RefreshButton, SectionHeading } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { overviewTotals } from '@/lib/overview'

export function spendingTotal(monitor: MonitorData, field: 'today' | 'spending') {
  const rows = monitor.spending.data?.rows
  if (!rows?.length || rows.length !== monitor.subscriptions.length || rows.some(row => row[field].data === null || row[field].error)) return null
  return sumMoney(rows.map(row => row[field].data!))
}
export function DashboardPage() {
  const { preferences } = useWorkspace()
  const monitor = useMonitor()
  const totals = useMemo(() => overviewTotals(preferences.pins, monitor.status.data, monitor.today.data?.items), [preferences.pins, monitor.status.data, monitor.today.data?.items])
  const statsError = monitor.spending.data?.rows.some(row => row.spending.error || row.today.error)
  return <div className="page-stack"><PageHeading title="概览" action={<RefreshButton countdown={monitor.nextRefreshIn} busy={monitor.quota.isFetching} label="刷新额度" onClick={() => void monitor.refreshQuota()} />} />
    <ErrorNotice message={monitor.status.error?.message ?? monitor.today.error?.message ?? monitor.quota.error?.message ?? monitor.spending.error?.message} />
    <div className="metric-grid">
      <Metric label="今日消费" value={<Money value={spendingTotal(monitor, 'today')} currency={preferences.actualCurrency} />} icon={<Wallet />} loading={monitor.spending.isFetching && !monitor.spending.data} />
      <Metric label="周期消费" value={<Money value={spendingTotal(monitor, 'spending')} currency={preferences.actualCurrency} />} icon={<Coins />} loading={monitor.spending.isFetching && !monitor.spending.data} />
      <Metric label="当前并发" value={<>{totals.concurrency ?? '—'}<span className="metric-denominator"> / {totals.concurrencyLimit ?? '—'}</span></>} icon={<Activity />} loading={monitor.status.isFetching && !monitor.status.data} />
      <Metric label="今日标准用量" value={<Money value={totals.standardUsage} />} icon={<ChartNoAxesCombined />} loading={monitor.today.isFetching && !monitor.today.data} />
    </div>
    {statsError && <ErrorNotice message="部分消费统计暂不可用" />}
    <section className="page-section" aria-labelledby="pinned-accounts-heading"><SectionHeading id="pinned-accounts-heading" title="关注的账号" icon={<Pin />} meta={<Badge variant="secondary" className="tabular-nums">{preferences.pins.length}</Badge>} action={<Button variant="ghost" asChild><Link to="/accounts" replace>管理账号<ArrowUpRight data-icon="inline-end" /></Link></Button>} />{preferences.pins.length ? <div className="account-grid">{preferences.pins.map(id => <AccountCard key={id} id={id} monitor={monitor} />)}</div> : <NoPins />}</section>

  </div>
}

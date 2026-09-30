import { CalendarDays, Coins, Wallet } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import Decimal from 'decimal.js'
import { useMemo } from 'react'
import { useWorkspace } from '@/lib/preferences'
import { useMonitor } from '@/lib/monitor'
import { ErrorNotice, Metric, Money, NoPins, PageHeading, RefreshButton } from '@/components/common'
import { spendingTotal } from './dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function StatisticsPage() {
  const { preferences } = useWorkspace(), monitor = useMonitor(undefined, true, 'statistics')
  const cost = useMemo(() => monitor.subscriptions.length ? monitor.subscriptions.reduce((sum, s) => sum.plus(s.price), new Decimal(0)).toNumber() : null, [monitor.subscriptions])
  return <div className="page-stack"><PageHeading title="消费统计" action={<RefreshButton busy={monitor.refreshing} onClick={() => void monitor.refresh()} />} /><ErrorNotice message={monitor.spending.error?.message ?? monitor.status.error?.message} /><div className="metric-grid three"><Metric label="今日消费" value={<Money value={spendingTotal(monitor, 'today')} currency={preferences.actualCurrency} />} icon={<Wallet />} /><Metric label="周期消费" value={<Money value={spendingTotal(monitor, 'spending')} currency={preferences.actualCurrency} />} icon={<Coins />} /><Metric label="成本" value={<Money value={cost} currency={preferences.costCurrency} />} icon={<CalendarDays />} /></div>
    {!preferences.pins.length ? <NoPins /> : !monitor.subscriptions.length ? <Alert><AlertTitle>暂无订阅</AlertTitle><AlertDescription><Button variant="link" asChild><Link to="/accounts">配置订阅</Link></Button></AlertDescription></Alert> : <Card><CardHeader><CardTitle>账号消费明细</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">{monitor.subscriptions.map(subscription => {
      const row = monitor.spending.data?.rows.find(row => row.accountId === subscription.accountId), account = monitor.status.data?.[subscription.accountId]?.data
      return <div className="spending-row" key={subscription.accountId}><div><Link className="account-name" to="/accounts/$id" params={{ id: String(subscription.accountId) }}>{account?.name ?? `账号 #${subscription.accountId}`}</Link><p className="text-sm text-muted-foreground">{row ? `${row.cycle.start} — ${row.cycle.end}` : '读取当前周期…'}</p></div><div className="spending-values"><div><span>今日消费</span><strong><Money value={row?.today.data} currency={preferences.actualCurrency} /></strong></div><div><span>周期消费</span><strong><Money value={row?.spending.data} currency={preferences.actualCurrency} /></strong></div><div><span>成本</span><strong><Money value={subscription.price} currency={preferences.costCurrency} /></strong></div></div>{(row?.spending.error || row?.today.error) && <ErrorNotice message={row.spending.error ?? row.today.error} />}</div>
    })}</CardContent></Card>}
</div>
}

import { useState } from 'react'
import { ArrowRightLeft, ChartPie, Layers } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SegmentedControl } from '@/components/segmented-control'
import { EmptyState, ErrorNotice, Money, RefreshButton } from '@/components/common'
import { RankingSkeletonRows, StableRegion } from '@/components/loading'
import { formatTokenCount } from '@/lib/token-count'
import { useWorkspace } from '@/lib/preferences'
import { Badge } from '@/components/ui/badge'
import type { RankingRange, Sample } from '../../shared/domain'
import { formatSpendingShare, type MoneyAmount } from '../../shared/money'

interface UsageRank { id: string | number; name: string; amount: MoneyAmount; requests: number; tokens: number }
interface UsageRanking { rows: UsageRank[]; totalAmount: MoneyAmount }

function UsageCountBadge({ metric, value, showLabel = false }: { metric: 'tokens' | 'requests'; value: number; showLabel?: boolean }) {
  const isToken = metric === 'tokens', Icon = isToken ? Layers : ArrowRightLeft
  const exact = value.toLocaleString('en-US'), label = `${exact} ${isToken ? 'Token' : '次请求'}`
  return <Badge variant="outline" className="max-w-full tabular-nums" aria-label={label} title={label}>
    <Icon data-icon="inline-start" aria-hidden="true" />
    <span className="truncate">{isToken ? formatTokenCount(value) : exact}{showLabel && (isToken ? ' Token' : ' 次')}</span>
  </Badge>
}

function SpendingShareBadge({ amount, total }: { amount: MoneyAmount; total: MoneyAmount }) {
  const { preferences } = useWorkspace()
  const share = formatSpendingShare(amount, total)
  const label = preferences.hideAmounts ? '消费占比已隐藏' : share === null ? '消费占比未知' : `消费占比 ${share}`
  return <Badge variant="secondary" className="tabular-nums" aria-label={label} title={label}>
    <ChartPie data-icon="inline-start" aria-hidden="true" />{preferences.hideAmounts ? '••••' : share ?? '—'}
  </Badge>
}

export function UsageRankingCard<Range extends RankingRange>({ title, description, dimension, sample, error, loading, currency, ranges, range, onRangeChange, onRefresh }: {
  title: string; description: string; dimension: string; sample?: Sample<UsageRanking>; error?: string; loading: boolean; currency: string;
  ranges: { value: Range; label: string }[]; range: Range; onRangeChange: (value: Range) => void; onRefresh: () => void;
}) {
  const message = error ?? sample?.error, ranking = sample?.data
  const pending = !ranking && !message
  const [placeholderRows, setPlaceholderRows] = useState(6)
  if (ranking && placeholderRows !== Math.max(3, ranking.rows.length)) setPlaceholderRows(Math.max(3, ranking.rows.length))
  return <Card className="usage-ranking" aria-busy={loading}>
    <CardHeader className="ranking-header">
      <div className="ranking-heading">
        <div className="ranking-summary">
          <CardTitle>{title}</CardTitle>
          <dl className="ranking-total"><dt>总消费</dt><dd><Money value={ranking?.totalAmount} currency={currency} loading={pending} /></dd></dl>
        </div>
        <CardDescription className="min-h-5">{description}</CardDescription>
      </div>
      <div className="ranking-controls">
        <SegmentedControl className="ranking-ranges" options={ranges} value={range} aria-label={`${title}时间范围`} onValueChange={onRangeChange} />
        <RefreshButton mode="icon" busy={loading} label={`刷新${title}`} onClick={onRefresh} />
      </div>
    </CardHeader>
    <CardContent><StableRegion phase={`${range}:${pending ? 'pending' : 'ready'}`} busy={loading} contentClassName="flex flex-col gap-4">
      <ErrorNotice message={message} />
      {pending || ranking?.rows.length ? <Table className="table-fixed" aria-label={title}>
        <TableHeader><TableRow><TableHead scope="col" className="w-9"><span className="sr-only">排名</span>#</TableHead><TableHead scope="col">{dimension}</TableHead><TableHead scope="col" className="w-24 text-right">消费</TableHead><TableHead scope="col" className="ranking-extra w-24 text-right">Token</TableHead><TableHead scope="col" className="ranking-extra w-24 text-right">请求</TableHead></TableRow></TableHeader>
        <TableBody>{pending ? <RankingSkeletonRows count={placeholderRows} /> : ranking!.rows.map((row, index) => <TableRow key={row.id} className="ranking-row">
          <TableCell><span className="text-muted-foreground tabular-nums">{index + 1}</span></TableCell>
          <TableCell><span className="block truncate" title={row.name}>{row.name}</span><span className="ranking-secondary"><UsageCountBadge metric="tokens" value={row.tokens} showLabel /><UsageCountBadge metric="requests" value={row.requests} showLabel /></span></TableCell>
          <TableCell className="ranking-amount text-right"><div className="flex flex-col items-end gap-1"><Money value={row.amount} currency={currency} /><SpendingShareBadge amount={row.amount} total={ranking!.totalAmount} /></div></TableCell>
          <TableCell className="ranking-extra text-right"><UsageCountBadge metric="tokens" value={row.tokens} /></TableCell>
          <TableCell className="ranking-extra text-right"><UsageCountBadge metric="requests" value={row.requests} /></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <EmptyState title={message ? `${title}暂不可用` : '暂无用量记录'} />}
      {pending && <span className="sr-only" role="status">正在读取排行榜</span>}
    </StableRegion></CardContent>
  </Card>
}

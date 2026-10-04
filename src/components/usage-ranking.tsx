import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SegmentedControl } from '@/components/segmented-control'
import { EmptyState, ErrorNotice, Money, RefreshButton } from '@/components/common'
import { RankingSkeletonRows, StableRegion } from '@/components/loading'
import { formatTokenCount } from '@/lib/token-count'
import type { RankingRange, Sample } from '../../shared/domain'
import type { MoneyAmount } from '../../shared/money'

interface UsageRank { id: string | number; name: string; amount: MoneyAmount; requests: number; tokens: number }
interface UsageRanking { rows: UsageRank[]; totalAmount: MoneyAmount }

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
        <TableHeader><TableRow><TableHead scope="col" className="w-9"><span className="sr-only">排名</span>#</TableHead><TableHead scope="col">{dimension}</TableHead><TableHead scope="col" className="w-24 text-right">消费</TableHead><TableHead scope="col" className="ranking-extra w-20 text-right">Token</TableHead><TableHead scope="col" className="ranking-extra w-16 text-right">请求</TableHead></TableRow></TableHeader>
        <TableBody>{pending ? <RankingSkeletonRows count={placeholderRows} /> : ranking!.rows.map((row, index) => <TableRow key={row.id} className="ranking-row">
          <TableCell><span className="text-muted-foreground tabular-nums">{index + 1}</span></TableCell>
          <TableCell><span className="block truncate" title={row.name}>{row.name}</span><span className="ranking-secondary"><span title={row.tokens.toLocaleString('en-US') + ' Token'} className="tabular-nums">{formatTokenCount(row.tokens)} Token</span><span className="tabular-nums">{row.requests.toLocaleString('en-US')} 次请求</span></span></TableCell>
          <TableCell className="ranking-amount text-right"><Money value={row.amount} currency={currency} /></TableCell>
          <TableCell className="ranking-extra text-right"><span title={row.tokens.toLocaleString('en-US') + ' Token'} className="tabular-nums">{formatTokenCount(row.tokens)}</span></TableCell>
          <TableCell className="ranking-extra text-right"><span className="text-muted-foreground tabular-nums">{row.requests.toLocaleString('en-US')}</span></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <EmptyState title={message ? `${title}暂不可用` : '暂无用量记录'} />}
      {pending && <span className="sr-only" role="status">正在读取排行榜</span>}
    </StableRegion></CardContent>
  </Card>
}

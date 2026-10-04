import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SegmentedControl } from '@/components/segmented-control'
import { ErrorNotice, Money } from '@/components/common'
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
  return <Card className="min-w-0" aria-busy={loading}>
    <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
        <div className="flex min-h-6 items-baseline justify-between gap-4 sm:justify-start">
          <CardTitle className="shrink-0">{title}</CardTitle>
          <dl className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-1"><dt className="text-xs text-muted-foreground">总消费</dt><dd className="min-w-0 text-right text-base font-medium wrap-anywhere"><Money value={ranking?.totalAmount} currency={currency} loading={pending} /></dd></dl>
        </div>
        <CardDescription className="min-h-5">{description}</CardDescription>
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <SegmentedControl className="min-w-0 flex-1 shrink sm:flex-none sm:shrink-0" options={ranges} value={range} aria-label={`${title}时间范围`} onValueChange={onRangeChange} />
        <Button type="button" variant="outline" size="icon" disabled={loading} aria-busy={loading} aria-label={`刷新${title}`} title={`刷新${title}`} onClick={onRefresh}>
          {loading ? <Spinner /> : <RefreshCw />}
        </Button>
      </div>
    </CardHeader>
    <CardContent><StableRegion phase={`${range}:${pending ? 'pending' : 'ready'}`} busy={loading} contentClassName="flex flex-col gap-4">
      <ErrorNotice message={message} />
      {pending || ranking?.rows.length ? <Table className="table-fixed" aria-label={title}>
        <TableHeader><TableRow><TableHead scope="col" className="w-9"><span className="sr-only">排名</span>#</TableHead><TableHead scope="col">{dimension}</TableHead><TableHead scope="col" className="w-24 text-right">消费</TableHead><TableHead scope="col" className="hidden w-20 text-right sm:table-cell">Token</TableHead><TableHead scope="col" className="hidden w-16 text-right sm:table-cell">请求</TableHead></TableRow></TableHeader>
        <TableBody>{pending ? <RankingSkeletonRows count={placeholderRows} /> : ranking!.rows.map((row, index) => <TableRow key={row.id} className="ranking-row">
          <TableCell><span className="text-muted-foreground tabular-nums">{index + 1}</span></TableCell>
          <TableCell><span className="block truncate" title={row.name}>{row.name}</span><span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden"><span title={row.tokens.toLocaleString('en-US') + ' Token'} className="tabular-nums">{formatTokenCount(row.tokens)} Token</span><span>{row.requests.toLocaleString('en-US')} 次请求</span></span></TableCell>
          <TableCell className="text-right"><Money value={row.amount} currency={currency} /></TableCell>
          <TableCell className="hidden text-right sm:table-cell"><span title={row.tokens.toLocaleString('en-US') + ' Token'} className="tabular-nums">{formatTokenCount(row.tokens)}</span></TableCell>
          <TableCell className="hidden text-right sm:table-cell"><span className="text-muted-foreground tabular-nums">{row.requests.toLocaleString('en-US')}</span></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty className="min-h-40"><EmptyHeader><EmptyTitle>{message ? `${title}暂不可用` : '暂无用量记录'}</EmptyTitle></EmptyHeader></Empty>}
      {pending && <span className="sr-only" role="status">正在读取排行榜</span>}
    </StableRegion></CardContent>
  </Card>
}

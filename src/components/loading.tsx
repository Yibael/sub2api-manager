import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/** Keep the previous height until the new content is measured. Never retain old data. */
export function StableRegion({ children, className, contentClassName, phase, busy }: {
  children: ReactNode; className?: string; contentClassName?: string; phase?: string; busy?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(), [resizing, setResizing] = useState(false)
  useLayoutEffect(() => {
    const element = content.current!
    let previous: { height: number; width: number } | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      const box = element.getBoundingClientRect(), next = { height: Math.ceil(box.height), width: Math.round(box.width) }
      if (previous?.height === next.height && previous.width === next.width) return
      clearTimeout(timer)
      // Responsive reflow should follow the viewport immediately, without clipping.
      const animate = !!previous && previous.width === next.width && !element.querySelector('[data-resizing="true"]') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      setResizing(animate); setHeight(next.height); previous = next
      if (animate) timer = setTimeout(() => setResizing(false), 220)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [])
  return <div className={cn('stable-region', className)} style={{ height }} data-resizing={resizing || undefined} aria-busy={busy || undefined}>
    <div ref={content} className="stable-region-measure"><div key={phase} className={cn(phase && 'content-enter', contentClassName)}>{children}</div></div>
  </div>
}

export function LoadingValue({ loading, children }: { loading: boolean; children: ReactNode }) {
  return <span className="loading-value" aria-busy={loading || undefined}>{loading
    ? <Skeleton asChild className="value-skeleton" aria-hidden="true"><span /></Skeleton>
    : <span className="content-enter">{children}</span>}</span>
}

export function QuotaSkeleton() {
  return <div className="quota-row" aria-hidden="true"><div className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-8" /></div><Skeleton className="h-[5px] w-full" /><div className="quota-footnote"><Skeleton className="h-3 w-28" /></div></div>
}

export function AccountSkeleton() {
  return <Card className="account-card" role="status" aria-label="正在读取账号"><CardHeader><div className="account-link flex min-w-0 items-center gap-3"><Skeleton className="size-[39px] shrink-0" /><div className="flex min-w-0 flex-col gap-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-20" /></div></div></CardHeader><CardContent className="flex flex-col gap-6"><div className="account-numbers"><div><p className="number-label">今日标准用量</p><div className="account-amount"><LoadingValue loading>—</LoadingValue></div></div><div><p className="number-label">当前并发</p><div className="concurrency"><LoadingValue loading>—</LoadingValue></div></div></div><div className="quota-list"><QuotaSkeleton /><QuotaSkeleton /></div></CardContent></Card>
}

export function DirectorySkeleton({ rows = 4 }: { rows?: number }) {
  return <div role="status" aria-label="正在读取账号目录">{Array.from({ length: rows }, (_, index) => <div key={index} className="directory-row" aria-hidden="true"><Skeleton className="size-[39px] shrink-0" /><div className="directory-info flex flex-col gap-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-20" /></div><div className="directory-actions"><Skeleton className="h-11 w-10 md:h-10" /><Skeleton className="h-11 w-20 md:h-10" /><Skeleton className="h-11 w-10 md:h-10" /></div></div>)}</div>
}

export function DetailSkeleton({ cycle = true }: { cycle?: boolean }) {
  return <div className="page-stack" role="status" aria-label="正在读取账号详情">
    <Card><CardHeader><div className="flex items-center gap-3"><Skeleton className="size-[39px] shrink-0" /><div className="flex flex-col gap-2"><CardTitle>运行状态</CardTitle><Skeleton className="h-4 w-24" /></div></div></CardHeader><CardContent><div className="detail-metrics">{['当前并发 / 上限', '今日请求', '今日 Token'].map(label => <div key={label}><p>{label}</p><strong><LoadingValue loading>—</LoadingValue></strong></div>)}</div><Skeleton className="mt-5 h-10 w-28" /></CardContent></Card>
    <div className="detail-grid"><Card><CardHeader><CardTitle>额度</CardTitle></CardHeader><CardContent><div className="quota-list"><QuotaSkeleton /><QuotaSkeleton /></div></CardContent></Card><Card><CardHeader><CardTitle>今日</CardTitle></CardHeader><CardContent><dl className="data-list">{['今日标准用量', '今日消费'].map(label => <div key={label}><dt>{label}</dt><dd><LoadingValue loading>—</LoadingValue></dd></div>)}</dl></CardContent></Card></div>
    {cycle && <Card><CardHeader><CardTitle>周期</CardTitle><Skeleton className="h-5 w-44" /></CardHeader><CardContent><dl className="data-list">{['成本', '周期消费'].map(label => <div key={label}><dt>{label}</dt><dd><LoadingValue loading>—</LoadingValue></dd></div>)}</dl></CardContent></Card>}
  </div>
}

export function LoginSkeleton() {
  return <Card role="status" aria-label="正在读取登录信息"><CardHeader><CardTitle>登录</CardTitle></CardHeader><CardContent className="flex flex-col gap-5"><div className="flex flex-col gap-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-11 w-full" /></div><Skeleton className="h-11 w-full" /></CardContent></Card>
}

export function RankingSkeletonRows({ count = 6 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <TableRow key={index} className="ranking-row" aria-hidden="true">
    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
    <TableCell><Skeleton className="h-4 w-24 max-w-full" /><Skeleton className="mt-2 h-3 w-16 sm:hidden" /></TableCell>
    <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
    <TableCell className="hidden sm:table-cell"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
  </TableRow>)}</>
}

export function RouteSkeleton() {
  const path = useRouterState({ select: state => state.location.pathname })
  const detail = /^\/accounts\/.+/.test(path), settings = path.startsWith('/settings')
  const title = detail ? '账号详情' : path === '/accounts' ? '账号管理' : path === '/statistics' ? '消费统计' : settings ? path.endsWith('/security') ? '登录与安全' : path.endsWith('/preferences') ? '刷新与统计' : path.endsWith('/connection') ? '连接设置' : path.endsWith('/app') ? '应用与数据' : '设置' : '概览'
  return <div className={cn('page-stack', settings && 'settings-page')} role="status" aria-label="正在读取页面">
    {(detail || settings && path !== '/settings') && <Skeleton className="h-10 w-24" />}
    <div className="page-heading"><h1>{title}</h1>{!settings && <Skeleton className="h-9 w-[76px]" />}</div>
    {detail ? <DetailSkeleton /> : settings ? <>{[1, 2].map(key => <Card key={key}><CardHeader><Skeleton className="h-5 w-24" /></CardHeader><CardContent className="flex flex-col gap-5">{[1, 2, 3].map(row => <Skeleton key={row} className="h-10 w-full" />)}</CardContent></Card>)}</> : <>
      {path !== '/accounts' && <div className={cn('metric-grid', path === '/statistics' && 'three')}>{Array.from({ length: path === '/statistics' ? 3 : 4 }, (_, index) => <Card key={index} className="metric-card"><CardHeader><Skeleton className="h-4 w-20" /></CardHeader><CardContent><div className="metric-value"><LoadingValue loading>—</LoadingValue></div></CardContent></Card>)}</div>}
      {path === '/accounts' ? <><div className="account-toolbar"><Skeleton className="h-11 w-full max-w-[420px]" /><Skeleton className="h-11 w-48" /></div><Card><CardHeader><CardTitle>账号目录</CardTitle><Skeleton className="h-5 w-40" /></CardHeader><CardContent className="account-list"><DirectorySkeleton /></CardContent></Card></> : path === '/statistics' ? <Card><CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-col gap-1"><CardTitle>消费榜</CardTitle><Skeleton className="h-5 w-44" /></div><Skeleton className="h-[52px] w-full sm:w-64 md:h-12" /></CardHeader><CardContent><Table className="table-fixed" aria-label="消费榜"><TableHeader><TableRow><TableHead className="w-9">#</TableHead><TableHead>用户</TableHead><TableHead className="w-24 text-right">消费</TableHead><TableHead className="hidden w-16 text-right sm:table-cell">请求</TableHead></TableRow></TableHeader><TableBody><RankingSkeletonRows /></TableBody></Table></CardContent></Card> : <><Skeleton className="h-10 w-40" /><div className="account-grid"><AccountSkeleton /><AccountSkeleton /></div></>}
    </>}
  </div>
}

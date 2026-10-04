import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { PageHeading, SectionHeading } from '@/components/page-heading'
import { ResourcesHeading } from '@/components/resources-heading'
import { Separator } from '@/components/ui/separator'
import { SlidersHorizontal } from 'lucide-react'

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
  return <Card className="account-card" role="status" aria-label="正在读取账号"><CardHeader className="gap-3"><div className="account-link flex min-w-0 items-center gap-3"><Skeleton className="size-10 shrink-0" /><Skeleton className="h-4 w-28" /></div><CardAction className="row-span-1 self-center"><Skeleton className="h-5 w-20" /></CardAction><CardDescription className="col-span-2 flex gap-1.5"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /></CardDescription></CardHeader><CardContent className="flex flex-col gap-6"><div className="account-numbers"><div><p className="number-label">今日标准用量</p><div className="account-amount"><LoadingValue loading>—</LoadingValue></div></div><div><p className="number-label">当前并发</p><div className="concurrency"><LoadingValue loading>—</LoadingValue></div></div></div><div className="quota-list"><QuotaSkeleton /><QuotaSkeleton /></div></CardContent></Card>
}

export function DirectorySkeleton({ rows = 4 }: { rows?: number }) {
  return <div role="status" aria-label="正在读取账号目录">{Array.from({ length: rows }, (_, index) => <div key={index} className="directory-row" aria-hidden="true"><Skeleton className="size-10 shrink-0" /><div className="directory-info flex flex-col gap-2"><div className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-20" /></div><div className="flex flex-wrap gap-1.5"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /><Skeleton className="h-5 w-8" /></div></div><div className="directory-actions"><Skeleton className="control-skeleton w-10" /><Skeleton className="control-skeleton w-20" /><Skeleton className="control-skeleton w-10" /></div></div>)}</div>
}

export function GroupDirectorySkeleton() {
  return <div role="status" aria-label="正在读取分组">
    <div className="group-list">{Array.from({ length: 4 }, (_, index) => <div key={index} className="group-row" aria-hidden="true">
      <div className="flex items-start gap-3"><Skeleton className="size-10 shrink-0" /><div className="flex min-w-0 flex-1 flex-col gap-2"><div className="flex items-center justify-between gap-3"><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-14" /></div><div className="flex gap-2"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /></div></div></div>
      <div className="flex items-center justify-between gap-3"><div className="flex flex-col gap-2"><Skeleton className="h-4 w-16" /><Skeleton className="h-5 w-12" /></div><Skeleton className="control-skeleton w-28" /></div>
    </div>)}</div>
    <div className="group-table"><Table><TableHeader><TableRow><TableHead>分组</TableHead><TableHead>状态</TableHead><TableHead className="text-right">默认倍率</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{Array.from({ length: 4 }, (_, index) => <TableRow key={index} aria-hidden="true"><TableCell><div className="flex items-center gap-3 py-2"><Skeleton className="size-10 shrink-0" /><div className="flex flex-col gap-2"><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-36" /></div></div></TableCell><TableCell><Skeleton className="h-5 w-14" /></TableCell><TableCell><Skeleton className="ml-auto h-5 w-12" /></TableCell><TableCell><Skeleton className="control-skeleton ml-auto w-28" /></TableCell></TableRow>)}</TableBody></Table></div>
  </div>
}

export function DetailSkeleton({ cycle = true }: { cycle?: boolean }) {
  return <div className="page-stack" role="status" aria-label="正在读取账号详情">
    <Card><CardHeader className="gap-3"><div className="flex items-center gap-3"><Skeleton className="size-10 shrink-0" /><CardTitle>运行状态</CardTitle></div><CardAction className="row-span-1 self-center"><Skeleton className="h-5 w-16" /></CardAction><CardDescription className="col-span-2 flex gap-2"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /><Skeleton className="h-5 w-8" /></CardDescription></CardHeader><CardContent><div className="detail-metrics">{['当前并发 / 上限', '今日请求', '今日 Token'].map(label => <div key={label}><p>{label}</p><strong><LoadingValue loading>—</LoadingValue></strong></div>)}</div><Skeleton className="mt-5 control-skeleton w-28" /></CardContent></Card>
    <div className="detail-grid"><Card><CardHeader><CardTitle>额度</CardTitle></CardHeader><CardContent><div className="quota-list"><QuotaSkeleton /><QuotaSkeleton /></div></CardContent></Card><Card><CardHeader><CardTitle>今日</CardTitle></CardHeader><CardContent><dl className="data-list">{['今日标准用量', '今日消费'].map(label => <div key={label}><dt>{label}</dt><dd><LoadingValue loading>—</LoadingValue></dd></div>)}</dl></CardContent></Card></div>
    {cycle && <Card><CardHeader><CardTitle>周期</CardTitle><CardDescription><Skeleton className="h-5 w-44 max-w-full" /></CardDescription><CardAction><Skeleton className="control-skeleton w-28" /></CardAction></CardHeader><CardContent><dl className="data-list">{['成本', '周期消费'].map(label => <div key={label}><dt>{label}</dt><dd><LoadingValue loading>—</LoadingValue></dd></div>)}</dl></CardContent></Card>}
  </div>
}

export function LoginSkeleton() {
  return <Card role="status" aria-label="正在读取登录信息"><CardHeader><CardTitle>登录</CardTitle></CardHeader><CardContent className="flex flex-col gap-5"><div className="flex flex-col gap-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-11 w-full" /></div><Skeleton className="h-11 w-full" /></CardContent></Card>
}

export function RankingSkeletonRows({ count = 6 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <TableRow key={index} className="ranking-row" aria-hidden="true">
    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
    <TableCell><Skeleton className="h-4 w-24 max-w-full" /><div className="ranking-secondary"><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-12" /></div></TableCell>
    <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
    <TableCell className="ranking-extra"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
    <TableCell className="ranking-extra"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
  </TableRow>)}</>
}

function RankingCardSkeleton({ title, dimension }: { title: string; dimension: string }) {
  return <Card className="usage-ranking"><CardHeader className="ranking-header"><div className="ranking-heading"><div className="ranking-summary"><CardTitle>{title}</CardTitle><dl className="ranking-total"><dt>总消费</dt><dd><LoadingValue loading>—</LoadingValue></dd></dl></div><Skeleton className="h-5 w-28" /></div><div className="ranking-controls"><Skeleton className="ranking-ranges-skeleton" /><Skeleton className="control-skeleton aspect-square" /></div></CardHeader><CardContent><Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-9">#</TableHead><TableHead>{dimension}</TableHead><TableHead className="w-24 text-right">消费</TableHead><TableHead className="ranking-extra w-20 text-right">Token</TableHead><TableHead className="ranking-extra w-16 text-right">请求</TableHead></TableRow></TableHeader><TableBody><RankingSkeletonRows /></TableBody></Table></CardContent></Card>
}

function MetricsSkeleton({ labels }: { labels: string[] }) {
  return <div className={cn('metric-grid', labels.length === 3 && 'three')}>{labels.map(label => <Card size="sm" key={label} className="metric-card"><CardHeader><CardDescription>{label}</CardDescription><CardAction><Skeleton className="size-4" /></CardAction></CardHeader><CardContent><div className="metric-value"><LoadingValue loading>—</LoadingValue></div></CardContent></Card>)}</div>
}

function FieldsSkeleton({ labels }: { labels: string[] }) {
  return <div className="flex flex-col gap-5">{labels.map(label => <div className="flex flex-col gap-2" key={label}><span>{label}</span><Skeleton className="h-11 w-full" /></div>)}</div>
}

function SettingsSkeleton({ path }: { path: string }) {
  if (path === '/settings') return <><Card><CardHeader><CardTitle>外观与隐私</CardTitle></CardHeader><CardContent className="flex flex-col gap-5"><div className="flex items-center justify-between gap-4"><span>主题</span><Skeleton className="theme-skeleton w-36" /></div><Separator /><div className="flex items-center justify-between gap-4"><span>隐藏金额</span><Skeleton className="h-5 w-8" /></div></CardContent></Card><Card><CardContent>{['连接设置', '登录与安全', '刷新与统计', '应用与数据'].map(title => <div className="settings-link" key={title}><Skeleton className="size-5" /><div><h3>{title}</h3></div><Skeleton className="size-4" /></div>)}</CardContent></Card></>
  if (path.endsWith('/preferences')) return <><Card><CardHeader><CardTitle>刷新间隔</CardTitle></CardHeader><CardContent><FieldsSkeleton labels={['账号状态与今日标准用量', '额度', '今日与周期消费']} /><div className="form-actions"><Skeleton className="control-skeleton w-32" /></div></CardContent></Card><Card><CardHeader><CardTitle>消费统计口径</CardTitle></CardHeader><CardContent className="flex flex-col gap-5"><FieldsSkeleton labels={['统计时区', '消费货币符号', '成本货币符号']} /><div className="flex items-center justify-between"><span>包含 Admin 消费</span><Skeleton className="h-5 w-8" /></div><p className="content-meta">货币符号不进行汇率换算。</p><Skeleton className="control-skeleton w-32" /></CardContent></Card></>
  if (path.endsWith('/connection')) return <><Card><CardHeader><CardTitle>当前连接</CardTitle></CardHeader><CardContent><dl className="data-list">{['工作空间', '服务器地址', '服务器时区', 'Admin Key'].map(label => <div key={label}><dt>{label}</dt><dd><Skeleton className="h-5 w-32" /></dd></div>)}</dl><Skeleton className="control-skeleton mt-5 w-28" /></CardContent></Card><Skeleton className="control-skeleton w-full" /></>
  if (path.endsWith('/security')) return <><Card><CardHeader><CardTitle>进入验证</CardTitle></CardHeader><CardContent><div className="flex items-start justify-between gap-4"><div className="flex flex-1 flex-col gap-2"><span>进入时验证</span><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" /></div><Skeleton className="h-5 w-8" /></div></CardContent></Card><Card><CardHeader><CardTitle>Passkey</CardTitle></CardHeader><CardContent className="flex flex-col gap-5"><FieldsSkeleton labels={['Passkey 名称']} /><Skeleton className="control-skeleton w-32" /><Separator /><Skeleton className="h-20 w-full" /></CardContent></Card></>
  return <><Card><CardHeader><CardTitle>添加到主屏幕</CardTitle></CardHeader><CardContent><Skeleton className="h-5 w-full" /></CardContent></Card><Card><CardHeader><CardTitle>配置备份</CardTitle></CardHeader><CardContent><div className="flex gap-3"><Skeleton className="control-skeleton w-28" /><Skeleton className="control-skeleton w-28" /></div><p className="content-meta mt-4">导入将替换当前配置。</p></CardContent></Card><Skeleton className="h-5 w-full" /></>
}

export function RouteSkeleton() {
  const path = useRouterState({ select: state => state.location.pathname })
  const detail = /^\/accounts\/.+/.test(path), settings = path.startsWith('/settings'), resources = path === '/accounts' || path === '/groups'
  const title = detail ? `账号 #${path.split('/').pop()}` : path === '/statistics' ? '统计' : settings ? path.endsWith('/security') ? '登录与安全' : path.endsWith('/preferences') ? '刷新与统计' : path.endsWith('/connection') ? '连接设置' : path.endsWith('/app') ? '应用与数据' : '设置' : '概览'
  const refresh = <Skeleton className="control-skeleton w-28" />
  return <div className={cn('page-stack', settings && 'settings-page')} role="status" aria-label="正在读取页面">
    {resources ? <ResourcesHeading section={path === '/groups' ? 'groups' : 'accounts'} action={refresh} /> : <PageHeading title={title} back={detail ? '/accounts' : settings && path !== '/settings' ? '/settings' : undefined} action={!settings && path !== '/statistics' ? refresh : undefined} />}
    {detail ? <DetailSkeleton /> : settings ? <SettingsSkeleton path={path} /> : resources ? <>
      <div className="account-toolbar"><Skeleton className="h-11 w-full max-w-[420px]" /><Skeleton className="control-skeleton w-48" /></div>
      <Card className={path === '/groups' ? 'group-directory' : undefined}><CardHeader><CardTitle><span className="flex items-center gap-2"><SlidersHorizontal className="size-4" />{path === '/groups' ? '分组目录' : '账号目录'}</span></CardTitle><Skeleton className="h-5 w-32" /></CardHeader><CardContent className={path === '/accounts' ? 'account-list' : undefined}>{path === '/groups' ? <GroupDirectorySkeleton /> : <DirectorySkeleton />}</CardContent></Card>
    </> : path === '/statistics' ? <>
      <section className="page-section"><SectionHeading title="全站榜单" description="按实际消费排序" /><RankingCardSkeleton title="消费榜" dimension="用户" /><RankingCardSkeleton title="模型榜" dimension="模型" /></section>
      <section className="page-section"><SectionHeading title="订阅与成本" description="仅汇总已关注且配置订阅的账号" /><MetricsSkeleton labels={['今日消费', '周期消费', '成本']} /><Card><CardHeader><CardTitle>账号消费明细</CardTitle></CardHeader><CardContent><Skeleton className="h-32 w-full" /></CardContent></Card></section>
    </> : <>
      <MetricsSkeleton labels={['今日消费', '周期消费', '当前并发', '今日标准用量']} />
      <section className="page-section"><SectionHeading title="关注的账号" action={<Skeleton className="control-skeleton w-28" />} /><div className="account-grid"><AccountSkeleton /><AccountSkeleton /></div></section>
    </>}
  </div>
}

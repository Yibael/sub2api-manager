import { ArrowUpRight, CircleAlert, Gauge, Layers, Pin, Plus, RefreshCw } from 'lucide-react'
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg'
import claudeIcon from '@lobehub/icons-static-svg/icons/claude.svg'
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini.svg'
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity.svg'
import grokIcon from '@lobehub/icons-static-svg/icons/grok.svg'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { AccountBadges, AccountStatusBadges } from '@/components/account-badges'
import { AccountSkeleton, LoadingValue, QuotaSkeleton, StableRegion } from '@/components/loading'
import { useWorkspace } from '@/lib/preferences'
import { cn } from '@/lib/utils'
import { formatQuotaCountdown } from '@/lib/quota-countdown'
import { type Quota } from '../../shared/domain'
import { formatMoney, type MoneyInput } from '../../shared/money'
import type { MonitorData } from '@/lib/monitor'

export { PageHeading, SectionHeading, BackButton } from '@/components/page-heading'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>{!compact && <span className="brand-name">sub2api <span className="text-muted-foreground">manager</span></span>}</div>
}
export function Money({ value, currency = '$', loading = false }: { value: MoneyInput | null | undefined; currency?: string; loading?: boolean }) {
  const { preferences } = useWorkspace()
  const amount = formatMoney(value)
  return <span className="tabular-nums"><LoadingValue loading={loading}>{preferences.hideAmounts ? '••••' : amount === null ? '—' : currency + amount}</LoadingValue></span>
}
const providerIcons: Record<string, string> = { openai: openaiIcon, anthropic: claudeIcon, gemini: geminiIcon, antigravity: antigravityIcon, grok: grokIcon }
export function ProviderMark({ platform }: { platform: string }) {
  const icon = providerIcons[platform]
  return <div className="provider-mark" aria-hidden="true">{icon ? <span className="provider-icon" style={{ maskImage: `url("${icon}")`, WebkitMaskImage: `url("${icon}")` }} /> : <Layers className="size-6" />}</div>
}
export function ErrorNotice({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return <Alert variant="destructive"><CircleAlert /><AlertTitle>操作未完成</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>
}
export function RefreshButton({ busy, onClick, countdown, label = '刷新', mode = 'label' }: {
  busy: boolean; onClick: () => void; countdown?: number | null; label?: string; mode?: 'label' | 'icon';
}) {
  const [finishing, setFinishing] = useState(busy)
  if (busy && !finishing) setFinishing(true)
  useEffect(() => {
    if (busy || !finishing) return
    const timer = window.setTimeout(() => setFinishing(false), 300)
    return () => window.clearTimeout(timer)
  }, [busy, finishing])
  const loading = busy || finishing
  return <div className="refresh-action">
    {countdown != null && <span className="refresh-countdown" title={`${countdown} 秒后自动刷新额度`}>{countdown}s</span>}
    <Button type="button" className="refresh-button" variant="outline" size={mode === 'icon' ? 'icon' : 'default'} onClick={onClick} disabled={loading} aria-busy={loading} aria-label={label} title={label}>
      {loading ? <Spinner data-icon={mode === 'label' ? 'inline-start' : undefined} /> : <RefreshCw data-icon={mode === 'label' ? 'inline-start' : undefined} />}
      {mode === 'label' && label}
    </Button>
  </div>
}
export function EmptyState({ title, description, icon, action, panel = false }: {
  title: string; description?: ReactNode; icon?: ReactNode; action?: ReactNode; panel?: boolean;
}) {
  return <Empty className={cn('empty-state', panel && 'empty-panel')}><EmptyHeader>{icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}<EmptyTitle>{title}</EmptyTitle>{description && <EmptyDescription>{description}</EmptyDescription>}</EmptyHeader>{action && <EmptyContent>{action}</EmptyContent>}</Empty>
}
export function NoPins() {
  return <EmptyState panel title="暂无关注账号" icon={<Pin />} action={<Button asChild><Link to="/accounts" replace><Plus data-icon="inline-start" />选择账号</Link></Button>} />
}
export function Metric({ label, value, icon, loading = false }: { label: string; value: ReactNode; icon: ReactNode; loading?: boolean }) {
  return <Card size="sm" className="metric-card"><CardHeader><CardDescription>{label}</CardDescription><CardAction><span className="metric-icon">{icon}</span></CardAction></CardHeader><CardContent><div className="metric-value"><LoadingValue loading={loading}>{value}</LoadingValue></div></CardContent></Card>
}
export function QuotaRow({ quota, now, estimatedCost }: { quota: Quota; now: number; estimatedCost?: MoneyInput | null }) {
  const reset = formatQuotaCountdown(quota.resetsAt, now)
  return <div className={cn('quota-row', quota.percent !== null && quota.percent >= 90 && 'quota-warning')}>
    <div className="flex items-center justify-between gap-3"><span>{quota.name}</span><span className="quota-number">{quota.percent === null ? '未知' : `${quota.percent.toFixed(0)}%`}</span></div>
    <Progress value={quota.percent === null ? 0 : Math.min(100, quota.percent)} aria-label={`${quota.name}已用`} />
    <div className="quota-footnote">
      {reset && <span className="tabular-nums">{reset}</span>}
      {quota.limit !== null && <span><Money value={quota.used} /> / <Money value={quota.limit} /></span>}
      {estimatedCost !== undefined && <span className="quota-estimate">估算额度 <Money value={estimatedCost} /></span>}
    </div>
  </div>
}
export function QuotaList({ quotas, pending, empty, now, estimatedCost, limit }: {
  quotas: Quota[]; pending: boolean; empty: string; now: number; estimatedCost?: MoneyInput | null; limit?: number;
}) {
  return <StableRegion busy={pending} phase={pending ? 'pending' : 'ready'}><div className={cn('quota-list', !pending && !quotas.length && 'quota-list-empty')}>
    {pending ? <><QuotaSkeleton /><QuotaSkeleton /><span className="sr-only" role="status">正在读取额度</span></> : quotas.length ? (limit ? quotas.slice(0, limit) : quotas).map(q => <QuotaRow key={q.name} quota={q} now={now} estimatedCost={q.name === '7日额度' ? estimatedCost : undefined} />) : <Empty className="quota-empty-state"><EmptyHeader><EmptyMedia variant="icon"><Gauge aria-hidden="true" /></EmptyMedia><EmptyTitle>{empty}</EmptyTitle></EmptyHeader></Empty>}
  </div></StableRegion>
}
export function AccountCard({ id, monitor }: { id: number; monitor: MonitorData }) {
  const sample = monitor.status.data?.[id], account = sample?.data
  if (!account) return <StableRegion phase={sample?.error || monitor.status.error ? 'error' : 'pending'}>{sample?.error || monitor.status.error ? <Card className="account-card"><CardHeader><CardTitle>账号 #{id}</CardTitle><CardDescription>{sample?.error ?? monitor.status.error?.message}</CardDescription></CardHeader><CardContent><p className="quota-empty">账号暂不可用</p></CardContent><CardFooter><Button variant="ghost" asChild><Link to="/accounts" replace>管理账号<ArrowUpRight data-icon="inline-end" /></Link></Button></CardFooter></Card> : <AccountSkeleton />}</StableRegion>
  const usage = monitor.quota.data?.[id], today = monitor.today.data?.items[id]
  const quotas = account.supportsUsage ? usage?.data?.windows ?? [] : account.localQuotas
  const weeklyEstimate = account.platform === 'openai' && account.type === 'oauth' ? usage?.data?.estimatedWeeklyCost ?? null : undefined
  const errors = [sample.error, today?.error, usage?.error].filter(Boolean)
  return <StableRegion phase="ready"><Card className="account-card"><CardHeader className="gap-3"><Link className="account-link flex min-w-0 items-center gap-3" to="/accounts/$id" params={{ id: String(id) }}><ProviderMark platform={account.platform} /><CardTitle className="min-w-0"><span className="account-name">{account.name}</span></CardTitle></Link><CardAction className="row-span-1 self-center"><AccountStatusBadges account={account} now={monitor.now} stale={!!sample.error || !!monitor.status.error} /></CardAction><CardDescription className="col-span-2"><AccountBadges account={account} /></CardDescription></CardHeader><CardContent className="flex flex-col gap-6"><div className="account-numbers"><div><p className="number-label">今日标准用量</p><div className="account-amount"><Money value={today?.data?.standardCost} loading={!today?.data && !today?.error && !monitor.today.error} /></div></div><div><p className="number-label">当前并发</p><div className="concurrency">{account.currentConcurrency ?? '—'}<span> / {account.concurrency ?? '—'}</span></div></div></div><QuotaList quotas={quotas} pending={account.supportsUsage && !usage?.data && !usage?.error && !monitor.quota.error} empty={account.supportsUsage ? usage?.error ?? '暂无可用额度数据' : '未配置额度'} now={monitor.now} estimatedCost={weeklyEstimate} limit={2} />{errors.length > 0 && <p role="status" className="field-warning">{errors.join('；')}。{sample.updatedAt ? `最近成功：${new Date(sample.updatedAt).toLocaleTimeString('zh-CN')}` : ''}</p>}</CardContent></Card></StableRegion>
}

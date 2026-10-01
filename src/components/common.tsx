import { ArrowUpRight, CircleAlert, Layers, Pin, Plus, RefreshCw } from 'lucide-react'
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg'
import claudeIcon from '@lobehub/icons-static-svg/icons/claude.svg'
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini.svg'
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity.svg'
import grokIcon from '@lobehub/icons-static-svg/icons/grok.svg'
import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyContent } from '@/components/ui/empty'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { AccountSkeleton, LoadingValue, QuotaSkeleton, StableRegion } from '@/components/loading'
import { useWorkspace } from '@/lib/preferences'
import { cn } from '@/lib/utils'
import { accountState, providerNames, type Account, type Quota } from '../../shared/domain'
import type { MonitorData } from '@/lib/monitor'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>{!compact && <span className="brand-name">sub2api <span className="text-muted-foreground">manager</span></span>}</div>
}
export function Money({ value, currency = '$', loading = false }: { value: number | null | undefined; currency?: string; loading?: boolean }) {
  const { preferences } = useWorkspace()
  return <span className="tabular-nums"><LoadingValue loading={loading}>{preferences.hideAmounts ? '••••' : value === null || value === undefined ? '—' : `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</LoadingValue></span>
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
export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-heading"><h1 title={title}>{title}</h1>{action}</div>
}
export function RefreshButton({ busy, onClick, countdown, label = '立即刷新' }: { busy: boolean; onClick: () => void; countdown?: number | null; label?: string }) {
  const [finishing, setFinishing] = useState(busy)
  if (busy && !finishing) setFinishing(true)
  useEffect(() => {
    if (busy || !finishing) return
    const timer = window.setTimeout(() => setFinishing(false), 300)
    return () => window.clearTimeout(timer)
  }, [busy, finishing])
  const loading = busy || finishing
  return <Button className="refresh-button" variant="outline" onClick={onClick} disabled={loading} aria-busy={loading} aria-label={loading ? '正在刷新' : label}>
    <span className="refresh-icon" aria-hidden="true">{loading ? <Spinner /> : <RefreshCw className="size-4" />}</span>
    <span className="refresh-label">{loading ? '刷新中' : countdown == null ? '刷新' : `${countdown}s`}</span>
  </Button>
}
export function NoPins() {
  return <Empty className="empty-panel"><EmptyHeader><EmptyMedia variant="icon"><Pin /></EmptyMedia><EmptyTitle>暂无关注账号</EmptyTitle></EmptyHeader><EmptyContent><Button asChild><Link to="/accounts"><Plus data-icon="inline-start" />选择账号</Link></Button></EmptyContent></Empty>
}
export function Metric({ label, value, icon, loading = false }: { label: string; value: ReactNode; icon: ReactNode; loading?: boolean }) {
  return <Card className="metric-card"><CardHeader><CardDescription>{label}</CardDescription><CardAction><span className="metric-icon">{icon}</span></CardAction></CardHeader><CardContent><div className="metric-value"><LoadingValue loading={loading}>{value}</LoadingValue></div></CardContent></Card>
}
export function QuotaRow({ quota, now, estimatedCost }: { quota: Quota; now: number; estimatedCost?: number | null }) {
  const remaining = quota.resetsAt ? Math.ceil((Date.parse(quota.resetsAt) - now) / 60000) : null
  const reset = remaining === null ? null : remaining <= 0 ? '等待额度更新' : remaining >= 1440 ? `${Math.floor(remaining / 1440)} 天后重置` : remaining >= 60 ? `${Math.floor(remaining / 60)} 小时 ${remaining % 60} 分后重置` : `${remaining} 分钟后重置`
  return <div className={cn('quota-row', quota.percent !== null && quota.percent >= 90 && 'quota-warning')}>
    <div className="flex items-center justify-between gap-3"><span>{quota.name}</span><span className="quota-number">{quota.percent === null ? '未知' : `${quota.percent.toFixed(0)}%`}</span></div>
    <Progress value={quota.percent === null ? 0 : Math.min(100, quota.percent)} aria-label={`${quota.name}已用`} />
    <div className="quota-footnote">
      {reset && <span>{reset}</span>}
      {quota.limit !== null && <span><Money value={quota.used} /> / <Money value={quota.limit} /></span>}
      {estimatedCost !== undefined && <span className="quota-estimate">估算额度 <Money value={estimatedCost} /></span>}
    </div>
  </div>
}
export function QuotaList({ quotas, pending, empty, now, estimatedCost, limit }: {
  quotas: Quota[]; pending: boolean; empty: string; now: number; estimatedCost?: number | null; limit?: number;
}) {
  return <StableRegion busy={pending} phase={pending ? 'pending' : 'ready'}><div className="quota-list">
    {pending ? <><QuotaSkeleton /><QuotaSkeleton /><span className="sr-only" role="status">正在读取额度</span></> : quotas.length ? (limit ? quotas.slice(0, limit) : quotas).map(q => <QuotaRow key={q.name} quota={q} now={now} estimatedCost={q.name === '7日额度' ? estimatedCost : undefined} />) : <p className="quota-empty">{empty}</p>}
  </div></StableRegion>
}
export function AccountCard({ id, monitor }: { id: number; monitor: MonitorData }) {
  const sample = monitor.status.data?.[id], account = sample?.data
  if (!account) return <StableRegion phase={sample?.error || monitor.status.error ? 'error' : 'pending'}>{sample?.error || monitor.status.error ? <Card className="account-card"><CardHeader><CardTitle>账号 #{id}</CardTitle><CardDescription>{sample?.error ?? monitor.status.error?.message}</CardDescription></CardHeader><CardContent><p className="quota-empty">账号暂不可用</p></CardContent><CardFooter><Button variant="ghost" asChild><Link to="/accounts">管理账号<ArrowUpRight data-icon="inline-end" /></Link></Button></CardFooter></Card> : <AccountSkeleton />}</StableRegion>
  const usage = monitor.quota.data?.[id], today = monitor.today.data?.items[id]
  const quotas = account.supportsUsage ? usage?.data?.windows ?? [] : account.localQuotas
  const weeklyEstimate = account.platform === 'openai' && account.type === 'oauth' ? usage?.data?.estimatedWeeklyCost ?? null : undefined
  const state = accountState(account, monitor.now)
  const errors = [sample.error, today?.error, usage?.error].filter(Boolean)
  return <StableRegion phase="ready"><Card className={cn('account-card', sample.error && 'account-stale')}><CardHeader><Link className="account-link flex min-w-0 items-center gap-3" to="/accounts/$id" params={{ id: String(id) }}><ProviderMark platform={account.platform} /><div className="min-w-0"><CardTitle><span className="account-name">{account.name}</span></CardTitle><CardDescription>{providerNames[account.platform] ?? account.platform} <span className="mx-1">·</span> {account.type === 'oauth' ? 'OAuth' : account.type === 'setup-token' ? 'Setup Token' : 'API Key'}</CardDescription></div></Link><CardAction><Badge variant="outline" className={cn('state-badge', state === '可调度' && !sample.error && 'state-ok')}><span className="status-dot" />{sample.error ? '更新失败' : state}</Badge></CardAction></CardHeader><CardContent className="flex flex-col gap-6"><div className="account-numbers"><div><p className="number-label">今日标准用量</p><div className="account-amount"><Money value={today?.data?.standardCost} loading={!today?.data && !today?.error && !monitor.today.error} /></div></div><div><p className="number-label">当前并发</p><div className="concurrency">{account.currentConcurrency ?? '—'}<span> / {account.concurrency ?? '—'}</span></div></div></div><QuotaList quotas={quotas} pending={account.supportsUsage && !usage?.data && !usage?.error && !monitor.quota.error} empty={account.supportsUsage ? usage?.error ?? '暂无可用额度数据' : '未配置额度'} now={monitor.now} estimatedCost={weeklyEstimate} limit={2} />{errors.length > 0 && <p role="status" className="field-warning">{errors.join('；')}。{sample.updatedAt ? `最近成功：${new Date(sample.updatedAt).toLocaleTimeString('zh-CN')}` : ''}</p>}</CardContent></Card></StableRegion>
}
export function accountLabel(account: Account) { return `${providerNames[account.platform] ?? account.platform} · ${account.type === 'oauth' ? 'OAuth' : 'API Key'}` }

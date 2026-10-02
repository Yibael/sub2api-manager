import { Check, CircleAlert, CircleHelp, Clock3, Pause, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { accountState, providerNames, type Account } from '../../shared/domain'

const typeNames: Record<string, string> = { oauth: 'OAuth', apikey: 'API Key', 'setup-token': 'Setup Token' }

export function AccountBadges({ account, showId = false }: { account: Account; showId?: boolean }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-1.5">
    <Badge variant="outline">{providerNames[account.platform] ?? account.platform}</Badge>
    <Badge variant="secondary">{typeNames[account.type] ?? account.type}</Badge>
    {showId && <Badge variant="outline" aria-label={`账号 ID ${account.id}`}>#{account.id}</Badge>}
  </div>
}

export function AccountStatusBadges({ account, now, stale = false }: { account: Account; now: number; stale?: boolean }) {
  const state = accountState(account, now)
  const paused = state === '已停用' || state === '已停调度'
  const variant = state === '账号异常' ? 'destructive' : state === '可调度' || paused ? 'secondary' : 'outline'
  const Icon = state === '可调度' ? Check : paused ? Pause : state === '状态未知' ? CircleHelp : state === '限流中' || state === '暂不可调度' ? Clock3 : CircleAlert
  return <div className="flex shrink-0 flex-col items-end gap-1.5">
    <Badge variant={variant} title={stale ? '最近成功获取的账号状态' : undefined}><Icon data-icon="inline-start" />{state}</Badge>
    {stale && <Badge variant="destructive"><RefreshCw data-icon="inline-start" />更新失败</Badge>}
  </div>
}

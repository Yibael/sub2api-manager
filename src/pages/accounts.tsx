import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ArrowUpRight, Pin, PinOff, Search, SlidersHorizontal, CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { useDirectory, useNow } from '@/lib/monitor'
import { useWorkspace } from '@/lib/preferences'
import { ErrorNotice, Money, ProviderMark, RefreshButton } from '@/components/common'
import { ResourcesHeading } from '@/components/resources-heading'
import { AccountBadges, AccountStatusBadges } from '@/components/account-badges'
import { SubscriptionEditor } from '@/components/subscription-editor'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DirectorySkeleton, LoadingValue, StableRegion } from '@/components/loading'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import type { Account } from '../../shared/domain'

export function AccountsPage() {
  const now = useNow()
  const directory = useDirectory(), { preferences, update } = useWorkspace()
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [editing, setEditing] = useState<Account | null>(null)
  const accounts = directory.data?.data ?? []
  const filtered = accounts.filter(a => `${a.name} ${a.platform} ${a.id}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === 'pinned' && preferences.pins.includes(a.id) || filter === 'oauth' && a.type === 'oauth'))
    .sort((a, b) => (preferences.pins.includes(a.id) ? preferences.pins.indexOf(a.id) : 10000) - (preferences.pins.includes(b.id) ? preferences.pins.indexOf(b.id) : 10000))
  function togglePin(id: number) {
    if (!preferences.pins.includes(id) && preferences.pins.length >= 100) { toast.error('最多关注 100 个账号'); return }
    update({ pins: preferences.pins.includes(id) ? preferences.pins.filter(p => p !== id) : [...preferences.pins, id] })
  }
  function move(id: number, direction: number) {
    const pins = [...preferences.pins], index = pins.indexOf(id), target = index + direction
    if (target < 0 || target >= pins.length) return
    ;[pins[index], pins[target]] = [pins[target], pins[index]]
    update({ pins })
  }
  const missing = preferences.pins.filter(id => directory.data?.data && !accounts.some(a => a.id === id))
  const pending = !directory.data?.data && !directory.error && !directory.data?.error
  return <div className="page-stack"><ResourcesHeading section="accounts" action={<RefreshButton busy={directory.isFetching} onClick={() => void directory.forceRefresh()} />} /><ErrorNotice message={directory.error?.message ?? directory.data?.error} />
    <div className="account-toolbar"><div className="search-box"><Search className="size-4" /><Input aria-label="搜索账号" placeholder="搜索名称、平台或账号 ID…" value={search} onChange={e => setSearch(e.target.value)} /></div><ToggleGroup type="single" value={filter} onValueChange={value => { if (value) setFilter(value) }} variant="outline"><ToggleGroupItem value="all">全部</ToggleGroupItem><ToggleGroupItem value="pinned">已关注</ToggleGroupItem><ToggleGroupItem value="oauth">OAuth</ToggleGroupItem></ToggleGroup></div>
    <Card><CardHeader><CardTitle><span className="flex items-center gap-2"><SlidersHorizontal className="size-4" />账号目录</span></CardTitle><CardDescription className="flex flex-wrap items-center gap-2"><Badge variant="secondary"><LoadingValue loading={pending}>{accounts.length}</LoadingValue> 个账号</Badge><Badge variant="outline">{preferences.pins.length} 个已关注</Badge></CardDescription></CardHeader><CardContent className="account-list"><StableRegion phase={pending ? 'pending' : 'ready'} busy={directory.isFetching}>{pending ? <DirectorySkeleton rows={Math.min(6, Math.max(4, preferences.pins.length))} /> : filtered.length ? filtered.map(account => {
      const pinned = preferences.pins.includes(account.id), subscription = preferences.subscriptions.find(s => s.accountId === account.id)
      return <div key={account.id} className="directory-row"><ProviderMark platform={account.platform} /><div className="directory-info"><div className="flex min-w-0 items-start justify-between gap-3"><Link to="/accounts/$id" params={{ id: String(account.id) }} className="account-name min-w-0 flex-1">{account.name}</Link><AccountStatusBadges account={account} now={now} stale={!!directory.error || !!directory.data?.error} /></div><div className="mt-2"><AccountBadges account={account} showId /></div>{subscription && <span className="subscription-summary"><Money value={subscription.price} currency={preferences.costCurrency} /> / 周期 · 每月 {subscription.renewalDay} 日续费</span>}</div><div className="directory-actions">{pinned && <div className="flex items-center"><Button variant="ghost" size="icon" aria-label={`上移 ${account.name}`} disabled={preferences.pins.indexOf(account.id) === 0} onClick={() => move(account.id, -1)}><ArrowUp /></Button><Button variant="ghost" size="icon" aria-label={`下移 ${account.name}`} disabled={preferences.pins.indexOf(account.id) === preferences.pins.length - 1} onClick={() => move(account.id, 1)}><ArrowDown /></Button></div>}{account.type === 'oauth' && <Button variant="ghost" size="icon" aria-label={`编辑 ${account.name} 订阅`} onClick={() => setEditing(account)}><CreditCard /></Button>}<Button variant={pinned ? 'secondary' : 'outline'} aria-label={`${pinned ? '取消关注' : '关注'} ${account.name}`} onClick={() => togglePin(account.id)}>{pinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}<span>{pinned ? '已关注' : '关注'}</span></Button><Button variant="ghost" size="icon" asChild><Link aria-label={`查看 ${account.name}`} to="/accounts/$id" params={{ id: String(account.id) }}><ArrowUpRight /></Link></Button></div></div>
    }) : <Empty><EmptyHeader><EmptyTitle>{search || filter !== 'all' ? '没有匹配的账号' : '暂无账号'}</EmptyTitle></EmptyHeader></Empty>}</StableRegion></CardContent></Card>
    {missing.length > 0 && <Card><CardHeader><CardTitle>不可用的关注账号</CardTitle></CardHeader><CardContent>{missing.map(id => <div className="settings-row" key={id}><Badge variant="outline">账号 #{id}</Badge><Button variant="outline" onClick={() => togglePin(id)}>取消关注</Button></div>)}</CardContent></Card>}
    {editing && <SubscriptionEditor key={editing.id} account={editing} onClose={() => setEditing(null)} />}</div>
}

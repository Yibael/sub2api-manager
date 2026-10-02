import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, queryClient } from '@/lib/api'
import { addPasskey, browserSupportsWebAuthn, passkeyMessage } from '@/lib/passkeys'
import { Card, CardHeader, CardTitle, CardContent, CardAction } from '@/components/ui/card'
import { FieldGroup, Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { StableRegion } from '@/components/loading'
import { Skeleton } from '@/components/ui/skeleton'
import type { PasskeySummary } from '../../shared/preferences'

export function PasskeySettings() {
  const list = useQuery<{ items: PasskeySummary[] }>({ queryKey: ['passkeys'], queryFn: () => api('/passkeys'), staleTime: 0 })
  const [name, setName] = useState('我的 Passkey')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const pending = !list.data && !list.error
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(null)
    try {
      await action()
      await Promise.all([list.refetch(), queryClient.invalidateQueries({ queryKey: ['config'] })])
      toast.success(message)
    } catch (error) {
      setError(passkeyMessage(error))
    } finally { setBusy(false) }
  }
  return <Card><CardHeader><CardTitle>Passkey</CardTitle>{list.data && <CardAction><Badge variant="secondary">{list.data.items.length} 个</Badge></CardAction>}</CardHeader><CardContent className="flex flex-col gap-5">
    {!browserSupportsWebAuthn() && <Alert><AlertTitle>此浏览器暂不支持 Passkey</AlertTitle><AlertDescription>可继续使用访问密码登录。</AlertDescription></Alert>}
    {browserSupportsWebAuthn() && <form onSubmit={event => { event.preventDefault(); void run(() => addPasskey(name.trim()), 'Passkey 已添加') }}><FieldGroup><Field><FieldLabel htmlFor="passkey-name">Passkey 名称</FieldLabel><Input id="passkey-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} required /></Field></FieldGroup><Button className="mt-4" disabled={busy || !name.trim()} type="submit">{busy ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}添加 Passkey</Button></form>}
    <Separator />
    <StableRegion phase={pending ? 'pending' : 'ready'} busy={list.isFetching} contentClassName="flex flex-col gap-5">
      {list.error && <Alert variant="destructive"><AlertTitle>无法读取 Passkey</AlertTitle><AlertDescription>{list.error.message}<Button variant="outline" onClick={() => void list.refetch()}>重试</Button></AlertDescription></Alert>}
      {pending ? <div className="flex items-start justify-between gap-3" role="status" aria-label="正在读取 Passkey"><div className="flex flex-col gap-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-44" /><Skeleton className="h-3 w-32" /></div><Skeleton className="h-10 w-20" /></div> : list.data && (!list.data.items.length ? <p className="text-sm text-muted-foreground">尚未添加 Passkey</p> : list.data.items.map(key => <PasskeyItem key={key.id} value={key} disabled={busy} rename={name => run(() => api('/passkeys/rename', { id: key.id, name }), '名称已保存')} remove={() => run(() => api('/passkeys/remove', { id: key.id }), 'Passkey 已移除')} />))}
    </StableRegion>
    {error && <Alert variant="destructive"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </CardContent></Card>
}
function PasskeyItem({ value, disabled, rename, remove }: { value: PasskeySummary; disabled: boolean; rename: (name: string) => Promise<void>; remove: () => Promise<void> }) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(value.name), [confirm, setConfirm] = useState(false)
  return <div className="flex flex-col gap-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-medium truncate">{value.name}</h3><div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">创建于 {new Date(value.createdAt).toLocaleDateString('zh-CN')}</span>{value.lastUsedAt ? <span className="text-xs text-muted-foreground">最近使用 {new Date(value.lastUsedAt).toLocaleString('zh-CN')}</span> : <Badge variant="outline">尚未使用</Badge>}</div><p className="text-xs text-muted-foreground">{value.rpId}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={disabled} onClick={() => { setName(value.name); setEditing(!editing); setConfirm(false) }}>重命名</Button><Button variant="ghost" size="icon" disabled={disabled} aria-label={`移除 ${value.name}`} onClick={() => { setConfirm(!confirm); setEditing(false) }}><Trash2 /></Button></div></div>
    {editing && <form className="flex items-end gap-2" onSubmit={async event => { event.preventDefault(); await rename(name.trim()); setEditing(false) }}><Field className="flex-1"><FieldLabel htmlFor={`name-${value.id}`}>名称</FieldLabel><Input id={`name-${value.id}`} value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></Field><Button type="submit" disabled={disabled || !name.trim()}>保存</Button></form>}
    {confirm && <Alert><AlertTitle>移除此 Passkey？</AlertTitle><AlertDescription><p>之后仍可使用访问密码登录。</p><div className="flex gap-2 mt-2"><Button variant="destructive" size="sm" disabled={disabled} onClick={async () => { await remove(); setConfirm(false) }}>移除</Button><Button variant="outline" size="sm" disabled={disabled} onClick={() => setConfirm(false)}>取消</Button></div></AlertDescription></Alert>}
  </div>
}

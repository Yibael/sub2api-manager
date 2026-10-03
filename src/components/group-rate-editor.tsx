import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { pageSession } from '@/lib/page-session'
import { ErrorNotice } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { formatMultiplier, groupRateRequestSchema, type Group, type GroupRatePreview } from '../../shared/groups'

export function GroupRateEditor({ group, onClose, onSaved }: { group: Group; onClose: () => void; onSaved: (group: Group) => Promise<void> }) {
  const [currentGroup, setCurrentGroup] = useState(group)
  const [value, setValue] = useState(group.rateMultiplier ?? '')
  const [error, setError] = useState<string>(), [validation, setValidation] = useState<string>()
  const [preview, setPreview] = useState<GroupRatePreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null), [expired, setExpired] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!preview) return
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, preview.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [preview])
  function cancelConfirmation() {
    if (busy === 'save') return
    const previous = preview
    setPreview(null); setExpired(false)
    if (previous) void api(`/groups/${group.id}/rate/cancel`, { token: previous.token }).catch(() => {})
  }
  async function prepare() {
    if (busy) return
    const input = groupRateRequestSchema.safeParse({ rateMultiplier: value })
    if (!input.success) { setValidation(input.error.issues[0]?.message); return }
    setValidation(undefined); setError(undefined); setBusy('preview')
    try {
      const next = await api<GroupRatePreview>(`/groups/${group.id}/rate/preview`, input.data)
      if (active.current) { setCurrentGroup(next.group); setExpired(false); setPreview(next) }
    } catch (error) { if (active.current) setError((error as Error).message) }
    finally { if (active.current) setBusy(null) }
  }
  async function save() {
    if (!preview || busy || expired) return
    const epoch = pageSession.epoch
    setBusy('save'); setError(undefined)
    try {
      const saved = await api<Group>(`/groups/${group.id}/rate`, { token: preview.token }, undefined, 'PUT')
      pageSession.assertCurrent(epoch)
      await onSaved(saved)
      if (active.current) { toast.success('分组倍率已保存'); onClose() }
    } catch (error) {
      if (active.current) {
        setPreview(null)
        setError(error instanceof ApiError && error.status === 409 ? error.message : `${(error as Error).message}。请刷新分组核对当前倍率后再操作。`)
      }
    } finally { if (active.current) setBusy(null) }
  }
  return <Drawer open dismissible={!busy && !preview} onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DrawerContent className="mx-auto max-w-lg">
      <DrawerHeader><DrawerTitle>调整分组倍率</DrawerTitle><DrawerDescription>{group.name}</DrawerDescription></DrawerHeader>
      <form className="drawer-form" onSubmit={event => { event.preventDefault(); void prepare() }}>
        <FieldGroup>
          <Field><FieldLabel>当前默认倍率</FieldLabel><p className="tabular-nums">{formatMultiplier(currentGroup.rateMultiplier)}</p></Field>
          <Field data-invalid={!!validation} data-disabled={!!busy}>
            <FieldLabel htmlFor="group-rate">新默认倍率</FieldLabel>
            <Input id="group-rate" inputMode="decimal" autoComplete="off" maxLength={100} disabled={!!busy} aria-invalid={!!validation} aria-describedby="group-rate-description" value={value} onChange={event => { setValue(event.target.value); setValidation(undefined) }} />
            <FieldDescription id="group-rate-description">支持最多 4 位小数。用户专属倍率优先生效{currentGroup.imageRateIndependent ? '，图片使用独立倍率' : ''}。</FieldDescription>
            <FieldError>{validation}</FieldError>
          </Field>
        </FieldGroup>
        <div className="mt-4"><ErrorNotice message={error} /></div>
        <div className="mt-6 flex gap-3">
          <Button type="submit" disabled={!!busy} className="flex-1">{busy === 'preview' && <Spinner data-icon="inline-start" />}{busy === 'preview' ? '正在检查…' : '检查变更'}</Button>
          <Button type="button" variant="outline" disabled={!!busy} onClick={onClose}>取消</Button>
        </div>
      </form>
    </DrawerContent>
    <AlertDialog open={!!preview} onOpenChange={open => { if (!open) cancelConfirmation() }}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader><AlertDialogTitle>确认调整分组倍率？</AlertDialogTitle><AlertDialogDescription>保存到 sub2api 后，此分组将使用新的默认计费倍率。用户专属倍率{preview?.group.imageRateIndependent ? '和图片独立倍率' : ''}继续按各自设置生效。</AlertDialogDescription></AlertDialogHeader>
        {preview && <dl className="data-list"><div><dt>分组</dt><dd className="min-w-0 break-words">{preview.group.name}</dd></div><div><dt>当前默认倍率</dt><dd className="tabular-nums">{formatMultiplier(preview.group.rateMultiplier)}</dd></div><div><dt>新默认倍率</dt><dd className="tabular-nums">{formatMultiplier(preview.rateMultiplier)}</dd></div></dl>}
        {expired && <ErrorNotice message="确认已过期，请返回编辑重新检查变更。" />}
        <AlertDialogFooter><AlertDialogCancel disabled={busy === 'save'}>返回编辑</AlertDialogCancel><AlertDialogAction disabled={!!busy || expired} onClick={event => { event.preventDefault(); void save() }}>{busy === 'save' && <Spinner data-icon="inline-start" />}{busy === 'save' ? '保存中…' : '确认保存'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Drawer>
}

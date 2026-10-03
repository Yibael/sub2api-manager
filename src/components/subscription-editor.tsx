import { useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { useWorkspace } from '@/lib/preferences'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { subscriptionSchema, type Account } from '../../shared/domain'

const schema = z.object({ price: z.string().trim().min(1, '请填写成本').refine(value => subscriptionSchema.shape.price.safeParse(value).success, '价格应为不超过 1000000000 的非负数字'), renewalDay: z.string().refine(v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 31, '续费日应为 1–31') })
export function SubscriptionEditor({ account, onClose }: { account: Account; onClose: () => void }) {
  const { preferences, update, revision, getRevision, getPreferences, isSaving } = useWorkspace()
  const baseRevision = useRef(revision)
  const existing = preferences.subscriptions.find(s => s.accountId === account.id)
  const form = useForm({ defaultValues: { price: existing ? String(existing.price) : '', renewalDay: existing ? String(existing.renewalDay) : '' }, validators: { onSubmit: schema }, onSubmit: async ({ value }) => {
    const saved = await update({ subscriptions: [...preferences.subscriptions.filter(s => s.accountId !== account.id), { accountId: account.id, price: subscriptionSchema.shape.price.parse(value.price), renewalDay: Number(value.renewalDay) }] }, baseRevision.current)
    if (saved) { toast.success('订阅已保存'); onClose() } else resetAfterConflict()
  } })
  function resetAfterConflict() {
    if (baseRevision.current === getRevision()) return
    const latest = getPreferences().subscriptions.find(item => item.accountId === account.id)
    form.reset({ price: latest ? String(latest.price) : '', renewalDay: latest ? String(latest.renewalDay) : '' })
    baseRevision.current = getRevision()
  }
  return <Drawer open onOpenChange={open => { if (!open) onClose() }}><DrawerContent className="mx-auto max-w-lg"><DrawerHeader><DrawerTitle>编辑订阅</DrawerTitle><DrawerDescription>{account.name}</DrawerDescription></DrawerHeader><form className="drawer-form" onSubmit={e => { e.preventDefault(); void form.handleSubmit() }}><FieldGroup><form.Field name="price">{field => <Field data-invalid={!field.state.meta.isValid}><FieldLabel htmlFor="subscription-price">成本（{preferences.costCurrency}）</FieldLabel><Input id="subscription-price" inputMode="decimal" autoComplete="off" placeholder="例如 20.00" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} aria-invalid={!field.state.meta.isValid} /><FieldError errors={field.state.meta.errors} /></Field>}</form.Field><form.Field name="renewalDay">{field => <Field data-invalid={!field.state.meta.isValid}><FieldLabel htmlFor="renewal-day">续费日</FieldLabel><Input id="renewal-day" inputMode="numeric" placeholder="1–31" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} aria-invalid={!field.state.meta.isValid} /><FieldError errors={field.state.meta.errors} /></Field>}</form.Field></FieldGroup><div className="mt-6 flex gap-3">{existing && <Button type="button" variant="destructive" disabled={isSaving} onClick={async () => { if (await update({ subscriptions: preferences.subscriptions.filter(s => s.accountId !== account.id) }, baseRevision.current)) { toast.success('订阅配置已清除'); onClose() } else resetAfterConflict() }}>清除订阅</Button>}<Button className="flex-1" type="submit" disabled={isSaving}>保存订阅</Button><Button type="button" variant="outline" onClick={onClose}>取消</Button></div></form></DrawerContent></Drawer>
}

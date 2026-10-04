import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { ArrowRight, Unplug, Fingerprint } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { signInWithPasskey, browserSupportsWebAuthn, passkeyMessage } from '@/lib/passkeys'
import { AppUpdateCard } from '@/components/pwa'
import { Spinner } from '@/components/ui/spinner'
import { loginWithPassword } from '@/lib/api'
import { pageSession } from '@/lib/page-session'
import { AutomaticPasskeyPrompt } from '@/lib/automatic-passkey'
import { Brand, ErrorNotice } from '@/components/common'
import { StableRegion } from '@/components/loading'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FieldGroup, Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { PublicConfig } from '../../shared/domain'

export function SetupPage({ config }: { config: PublicConfig }) {
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const passkeyPending = useRef(false), automaticPrompt = useRef(new AutomaticPasskeyPrompt())
  const [error, setError] = useState<string | null>(null), queryClient = useQueryClient()
  const form = useForm({ defaultValues: { password: '' }, validators: { onSubmit: z.object({ password: z.string().min(1, '请输入访问密码') }) }, onSubmit: async ({ value }) => {
    setError(null)
    try { await loginWithPassword(value.password); await queryClient.invalidateQueries({ queryKey: ['config'] }) } catch (error) { setError((error as Error).message) }
  } })
  const passkeyEnabled = config.configured && config.passkeyAvailable && browserSupportsWebAuthn()
  const loginWithPasskey = useCallback(async () => {
    if (passkeyPending.current || pageSession.verifying || form.state.isSubmitting) return
    passkeyPending.current = true; setPasskeyBusy(true); setError(null)
    try { await signInWithPasskey(); await queryClient.invalidateQueries({ queryKey: ['config'] }) }
    catch (error) { setError(passkeyMessage(error)) }
    finally { passkeyPending.current = false; setPasskeyBusy(false) }
  }, [form, queryClient])
  useEffect(() => {
    if (!passkeyEnabled) return
    return automaticPrompt.current.bind(document,
      () => !passkeyPending.current && !pageSession.verifying && !form.state.isSubmitting,
      () => pageSession.verifying, () => { void loginWithPasskey() })
  }, [passkeyEnabled, form, loginWithPasskey])
  return (
    <main className="setup-screen">
      <div className="setup-panel">
        <Brand />
        <StableRegion><Card>
          <CardHeader><CardTitle>{config.configured ? '登录' : '连接设置'}</CardTitle></CardHeader>
          <CardContent>
            {config.configured ? (
              <form onSubmit={e => { e.preventDefault(); if (!passkeyPending.current) void form.handleSubmit() }}>
                {passkeyEnabled && <Button type="button" variant="outline" className="w-full mb-5" disabled={passkeyBusy || form.state.isSubmitting} onClick={() => { void loginWithPasskey() }}>{passkeyBusy ? <Spinner data-icon="inline-start" /> : <Fingerprint data-icon="inline-start" />}使用 Passkey 登录</Button>}
                <FieldGroup>
                  <form.Field name="password">{field => (
                    <Field data-invalid={!field.state.meta.isValid}>
                      <FieldLabel htmlFor="password">访问密码</FieldLabel>
                      <Input id="password" type="password" autoComplete="current-password" placeholder="输入访问密码" disabled={passkeyBusy} value={field.state.value} onChange={e => field.handleChange(e.target.value)} onBlur={field.handleBlur} aria-invalid={!field.state.meta.isValid} />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}</form.Field>
                </FieldGroup>
                <form.Subscribe selector={state => state.isSubmitting}>{pending => (
                  <Button disabled={pending || passkeyBusy} type="submit" className="mt-5 w-full">
                    {pending && <Spinner data-icon="inline-start" />}登录{!pending && <ArrowRight data-icon="inline-end" />}
                  </Button>
                )}</form.Subscribe>
                {error && <div className="mt-4"><ErrorNotice message={error} /></div>}
              </form>
            ) : (
              <div className="flex flex-col gap-4">
                <Empty><EmptyHeader><EmptyMedia variant="icon"><Unplug /></EmptyMedia><EmptyTitle>尚未连接服务器</EmptyTitle></EmptyHeader></Empty>
                <Button variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: ['config'] })}>重新检查</Button>
              </div>
            )}
          </CardContent>
        </Card></StableRegion>
        <AppUpdateCard />
      </div>
    </main>
  )
}

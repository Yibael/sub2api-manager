import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { ArrowRight, Unplug } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Brand, ErrorNotice } from '@/components/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FieldGroup, Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import type { PublicConfig } from '../../shared/domain'

export function SetupPage({ config }: { config: PublicConfig }) {
  const [error, setError] = useState<string | null>(null), queryClient = useQueryClient()
  const form = useForm({ defaultValues: { password: '' }, validators: { onSubmit: z.object({ password: z.string().min(1, '请输入访问密码') }) }, onSubmit: async ({ value }) => {
    setError(null)
    try { await api('/login', value); await queryClient.invalidateQueries({ queryKey: ['config'] }) } catch (error) { setError((error as Error).message) }
  } })
  return (
    <main className="setup-screen">
      <div className="setup-panel">
        <Brand />
        <Card>
          <CardHeader><CardTitle>{config.configured ? '登录' : '连接设置'}</CardTitle></CardHeader>
          <CardContent>
            {config.configured ? (
              <form onSubmit={e => { e.preventDefault(); void form.handleSubmit() }}>
                <FieldGroup>
                  <form.Field name="password">{field => (
                    <Field data-invalid={!field.state.meta.isValid}>
                      <FieldLabel htmlFor="password">访问密码</FieldLabel>
                      <Input id="password" type="password" autoComplete="current-password" placeholder="输入访问密码" value={field.state.value} onChange={e => field.handleChange(e.target.value)} onBlur={field.handleBlur} aria-invalid={!field.state.meta.isValid} />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}</form.Field>
                </FieldGroup>
                <form.Subscribe selector={state => state.isSubmitting}>{pending => (
                  <Button disabled={pending} type="submit" className="mt-5 w-full">
                    {pending ? '登录中…' : '登录'}<ArrowRight data-icon="inline-end" />
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
        </Card>
      </div>
    </main>
  )
}

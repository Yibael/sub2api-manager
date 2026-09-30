import { useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ArrowLeft, Network, RefreshCw, Smartphone, Moon, Sun, Monitor, Download, Upload, LogOut, EyeOff, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { useWorkspace, preferencesSchema } from '@/lib/preferences'
import { api } from '@/lib/api'
import { PageHeading, ErrorNotice } from '@/components/common'
import { InstallHelp } from '@/components/pwa'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { FieldGroup, Field, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { defaultIntervals, intervalsSchema, type Intervals } from '../../shared/domain'

export function SettingsPage() {
  const path = useRouterState({ select: state => state.location.pathname })
  const { preferences, update } = useWorkspace()
  return <div className="page-stack settings-page">{path !== '/settings' && <div><Button variant="ghost" asChild><Link to="/settings"><ArrowLeft data-icon="inline-start" />返回设置</Link></Button></div>}<PageHeading title={path.endsWith('/connection') ? '连接设置' : path.endsWith('/preferences') ? '刷新与统计' : path.endsWith('/app') ? '应用与数据' : '设置'} />
    {path === '/settings' ? <><Card><CardHeader><CardTitle>外观与隐私</CardTitle></CardHeader><CardContent><div className="settings-row"><div><h3>主题</h3></div><ToggleGroup type="single" value={preferences.theme} onValueChange={theme => { if (theme) update({ theme: theme as 'light' | 'dark' | 'system' }) }} variant="outline"><ToggleGroupItem value="light" aria-label="浅色主题"><Sun /></ToggleGroupItem><ToggleGroupItem value="dark" aria-label="深色主题"><Moon /></ToggleGroupItem><ToggleGroupItem value="system" aria-label="跟随系统"><Monitor /></ToggleGroupItem></ToggleGroup></div><Separator /><div className="settings-row"><div><h3 className="flex items-center gap-2"><EyeOff className="size-4" />隐藏金额</h3></div><Switch aria-label="隐藏金额" checked={preferences.hideAmounts} onCheckedChange={hideAmounts => update({ hideAmounts })} /></div></CardContent></Card><Card><CardContent className="settings-links">{[
      { to: '/settings/connection', icon: Network, title: '连接设置' },
      { to: '/settings/preferences', icon: SlidersHorizontal, title: '刷新与统计' },
      { to: '/settings/app', icon: Smartphone, title: '应用与数据' },
    ].map(item => <Link key={item.to} to={item.to} className="settings-link"><item.icon className="size-5" /><div><h3>{item.title}</h3></div><ChevronRight className="size-4" /></Link>)}</CardContent></Card></> : path.endsWith('/connection') ? <ConnectionSettings /> : path.endsWith('/preferences') ? <><RefreshSettings /><StatisticsSettings /></> : <AppSettings />}</div>
}
function ConnectionSettings() {
  const { config } = useWorkspace(), [checking, setChecking] = useState(false), [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  async function check() {
    setChecking(true); setError(null)
    try {
      const value = await api<{ error: string | null }>('/accounts')
      if (value.error) throw new Error(value.error)
      toast.success('连接正常')
    } catch (error) { setError((error as Error).message) } finally { setChecking(false) }
  }
  return <><Card><CardHeader><CardTitle>当前连接</CardTitle></CardHeader><CardContent><dl className="data-list"><div><dt>工作空间</dt><dd>{config.instanceName}</dd></div><div><dt>服务器地址</dt><dd className="break-all">{config.serverUrl}</dd></div><div><dt>服务器时区</dt><dd>{config.serverTimeZone}</dd></div><div><dt>Admin Key</dt><dd><Badge variant="secondary"><ShieldCheck data-icon="inline-start" />已配置</Badge></dd></div></dl><div className="mt-5"><Button variant="outline" disabled={checking} onClick={() => void check()}><RefreshCw data-icon="inline-start" />{checking ? '正在检查…' : '检查连接'}</Button></div></CardContent></Card><ErrorNotice message={error} /><Button variant="outline" onClick={async () => { try { await api('/logout', {}); await queryClient.cancelQueries(); queryClient.clear(); window.location.reload() } catch (error) { toast.error((error as Error).message) } }}><LogOut data-icon="inline-start" />退出登录</Button></>
}
function RefreshSettings() {
  const { config } = useWorkspace(), queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const form = useForm({ defaultValues: config.intervals ?? defaultIntervals, validators: { onSubmit: intervalsSchema }, onSubmit: async ({ value }) => {
    setError(null)
    try { await api('/intervals', value, undefined, 'PUT'); await queryClient.invalidateQueries({ queryKey: ['config'] }); toast.success('已保存') } catch (error) { setError((error as Error).message) }
  } })
  const fields = [{ key: 'status', label: '账号状态与今日标准用量', values: [2, 5, 10, 15, 30] }, { key: 'quota', label: '额度', values: [5, 10, 15, 30, 60, 120] }, { key: 'spending', label: '今日与周期消费', values: [2, 5, 10, 15, 30, 60, 120] }] as const
  return <Card><CardHeader><CardTitle>刷新间隔</CardTitle></CardHeader><CardContent><form onSubmit={e => { e.preventDefault(); void form.handleSubmit() }}><FieldGroup>{fields.map(item => <form.Field key={item.key} name={item.key}>{field => <Field><FieldLabel htmlFor={`interval-${item.key}`}>{item.label}</FieldLabel><Select value={String(field.state.value)} onValueChange={v => field.handleChange(Number(v) as Intervals[typeof item.key])}><SelectTrigger id={`interval-${item.key}`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{item.values.map(value => <SelectItem key={value} value={String(value)}>{value} 秒</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}</form.Field>)}</FieldGroup><div className="mt-5"><form.Subscribe selector={state => state.isSubmitting}>{pending => <Button disabled={pending} type="submit">{pending ? '保存中…' : '保存刷新设置'}</Button>}</form.Subscribe></div><ErrorNotice message={error} /></form></CardContent></Card>
}
function StatisticsSettings() {
  const { preferences, update } = useWorkspace()
  const schema = preferencesSchema.pick({ timeZone: true, actualCurrency: true, costCurrency: true, includeAdmin: true })
  const form = useForm({ defaultValues: { timeZone: preferences.timeZone, actualCurrency: preferences.actualCurrency, costCurrency: preferences.costCurrency, includeAdmin: preferences.includeAdmin }, validators: { onSubmit: schema }, onSubmit: ({ value }) => { update(value); toast.success('已保存') } })
  return <Card><CardHeader><CardTitle>消费统计口径</CardTitle></CardHeader><CardContent><form onSubmit={e => { e.preventDefault(); void form.handleSubmit() }}><FieldGroup>{([{ name: 'timeZone', label: '统计时区', placeholder: 'Asia/Shanghai' }, { name: 'actualCurrency', label: '消费货币符号', placeholder: '$' }, { name: 'costCurrency', label: '成本货币符号', placeholder: '$' }] as const).map(item => <form.Field key={item.name} name={item.name}>{field => <Field data-invalid={!field.state.meta.isValid}><FieldLabel htmlFor={item.name}>{item.label}</FieldLabel><Input id={item.name} value={field.state.value} placeholder={item.placeholder} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} aria-invalid={!field.state.meta.isValid} /><FieldError errors={field.state.meta.errors} /></Field>}</form.Field>)}<form.Field name="includeAdmin">{field => <Field orientation="horizontal"><FieldLabel htmlFor="include-admin">包含 Admin 消费</FieldLabel><Switch id="include-admin" checked={field.state.value} onCheckedChange={field.handleChange} /></Field>}</form.Field><FieldDescription>货币符号不进行汇率换算。</FieldDescription></FieldGroup><Button className="mt-5" type="submit">保存统计设置</Button></form></CardContent></Card>
}
function AppSettings() {
  const { config, preferences, update } = useWorkspace(), inputRef = useRef<HTMLInputElement>(null)
  function exportPreferences() {
    const blob = new Blob([JSON.stringify({ version: 1, instanceId: config.instanceId, preferences }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'sub2api-manager-settings.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('配置已导出')
  }
  async function importPreferences(file?: File) {
    if (!file) return
    try {
      if (file.size > 1_000_000) throw new Error('配置文件过大')
      const value = z.object({ version: z.literal(1), instanceId: z.string(), preferences: preferencesSchema }).parse(JSON.parse(await file.text()))
      if (value.instanceId !== config.instanceId) throw new Error('配置属于其他实例，无法导入')
      update(value.preferences); toast.success('配置已导入')
    } catch (error) { toast.error(error instanceof z.ZodError ? '配置文件格式无效' : (error as Error).message) }
    if (inputRef.current) inputRef.current.value = ''
  }
  return <><Card><CardHeader><CardTitle>添加到主屏幕</CardTitle></CardHeader><CardContent><InstallHelp /></CardContent></Card><Card><CardHeader><CardTitle>配置备份</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={exportPreferences}><Download data-icon="inline-start" />导出配置</Button><Button variant="outline" onClick={() => inputRef.current?.click()}><Upload data-icon="inline-start" />导入配置</Button><input ref={inputRef} type="file" accept=".json,application/json" className="hidden" aria-label="导入配置文件" onChange={e => void importPreferences(e.target.files?.[0])} /></div><p className="text-sm text-muted-foreground mt-4">导入将替换当前配置。</p></CardContent></Card><div className="app-version"><span>Sub2api Manager</span><span>v0.1.0</span></div></>
}

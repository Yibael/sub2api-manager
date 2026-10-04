import { useEffect, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'
import { Check, Download, Share, PlusSquare, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { PwaUpdateContext, usePwaUpdate } from '@/lib/pwa'

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function PwaProvider({ children }: { children: ReactNode }) {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({ onRegisterError: () => toast.error('离线功能暂不可用') })
  const [updating, setUpdating] = useState(false)
  async function update() {
    if (updating || !needRefresh) return
    setUpdating(true)
    try { await updateServiceWorker(true) }
    catch { toast.error('更新失败，请稍后重试') }
    finally { setUpdating(false) }
  }
  return <PwaUpdateContext.Provider value={{ needRefresh, updating, update }}>{children}</PwaUpdateContext.Provider>
}
export function AppUpdateCard() {
  const { needRefresh, updating, update } = usePwaUpdate()
  if (!needRefresh) return null
  return <Card><CardHeader><CardTitle>应用更新</CardTitle><CardDescription>有新版本可用</CardDescription><CardAction><Badge variant="secondary">可更新</Badge></CardAction></CardHeader>
    <CardContent className="flex flex-col gap-4"><p className="text-sm text-muted-foreground">更新后将重新加载页面。</p>
      <Button type="button" className="self-start" disabled={updating} aria-busy={updating} onClick={() => void update()}>{updating ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{updating ? '更新中…' : '更新并重载'}</Button>
    </CardContent></Card>
}
export function InstallHelp() {
  const [install, setInstall] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone)
  useEffect(() => {
    const before = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent) }
    const done = () => { setInstalled(true); setInstall(null) }
    window.addEventListener('beforeinstallprompt', before)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', done) }
  }, [])
  return <div className="flex flex-col gap-4">{installed ? <Badge variant="secondary"><Check data-icon="inline-start" />已安装</Badge> : install ? <Button onClick={async () => { await install.prompt(); const result = await install.userChoice; if (result.outcome === 'accepted') setInstall(null) }}><Download data-icon="inline-start" />安装应用</Button> : <p className="text-sm text-muted-foreground">Safari <Share className="inline size-4" /> 分享 → <PlusSquare className="inline size-4" /> 添加到主屏幕</p>}</div>
}

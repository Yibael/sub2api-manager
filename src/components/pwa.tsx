import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'
import { Check, Download, Share, PlusSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function PwaUpdate() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({ onRegisterError: () => toast.error('离线功能暂不可用') })
  if (!needRefresh) return null
  return <div className="pwa-update content-enter"><Alert><AlertTitle>有新版本可用</AlertTitle><AlertDescription><Button variant="outline" onClick={() => void updateServiceWorker(true)}>更新并重载</Button></AlertDescription></Alert></div>
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

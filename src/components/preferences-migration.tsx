import { useWorkspace } from '@/lib/preferences'
import { Button } from '@/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { toast } from 'sonner'
export function PreferencesMigration() {
  const { legacy, migrationPending, update, isSaving } = useWorkspace()
  if (!migrationPending || !legacy) return null
  return <Alert><AlertTitle>本机发现旧配置</AlertTitle><AlertDescription><p>可将关注账号、订阅和统计设置迁移到工作空间。</p><div className="flex flex-wrap gap-2 mt-2"><Button size="sm" disabled={isSaving} onClick={async () => { const { theme: _theme, hideAmounts: _hide, ...shared } = legacy; if (await update(shared)) toast.success('配置已迁移') }}>迁移本机配置</Button><Button size="sm" variant="outline" disabled={isSaving} onClick={() => void update({})}>使用服务器配置</Button></div></AlertDescription></Alert>
}

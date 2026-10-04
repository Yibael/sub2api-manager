import { createContext, useContext } from 'react'

export const PwaUpdateContext = createContext<{ needRefresh: boolean; updating: boolean; update: () => Promise<void> } | null>(null)
export function usePwaUpdate() {
  const value = useContext(PwaUpdateContext)
  if (!value) throw new Error('应用更新状态不可用')
  return value
}

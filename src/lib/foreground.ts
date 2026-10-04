import { useEffect, useState } from 'react'
import { queryClient } from './api'

export function useForeground() {
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  useEffect(() => {
    const change = () => {
      const shown = document.visibilityState === 'visible'
      setVisible(shown)
      if (!shown) void queryClient.cancelQueries({ predicate: query => query.meta?.poll === true })
      else void queryClient.invalidateQueries({ queryKey: ['config'] })
    }
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  return visible
}

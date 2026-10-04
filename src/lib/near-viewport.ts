import { useEffect, useRef, useState } from 'react'

/** Activate a card once, just before it enters the viewport. */
export function useNearViewport<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(() => !('IntersectionObserver' in window))
  useEffect(() => {
    const element = ref.current
    if (!element || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      setNear(true)
      observer.disconnect()
    }, { rootMargin: '200px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, near }
}

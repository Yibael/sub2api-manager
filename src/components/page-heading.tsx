import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useCanGoBack, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function PageHeading({ title, action, back }: { title: string; action?: ReactNode; back?: '/accounts' | '/settings' }) {
  return <header className="page-header">{back && <div className="page-back"><BackButton fallback={back} /></div>}<div className="page-heading"><h1 title={title}>{title}</h1>{action}</div></header>
}

export function SectionHeading({ title, id, description, icon, meta, action }: {
  title: string; id?: string; description?: ReactNode; icon?: ReactNode; meta?: ReactNode; action?: ReactNode;
}) {
  return <div className="section-heading"><div className="section-heading-content"><div className="section-heading-title">{icon}<h2 id={id}>{title}</h2>{meta}</div>{description && <p className="section-description">{description}</p>}</div>{action}</div>
}

export function BackButton({ fallback }: { fallback: '/accounts' | '/settings' }) {
  const router = useRouter(), canGoBack = useCanGoBack()
  return <Button type="button" variant="ghost" onClick={() => {
    if (canGoBack) router.history.back()
    else void router.navigate({ to: fallback, replace: true })
  }}><ArrowLeft data-icon="inline-start" />返回</Button>
}

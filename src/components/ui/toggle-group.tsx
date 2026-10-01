"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ref,
  style,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  const root = React.useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = React.useState<{ x: number; y: number; width: number; height: number; radius: string } | null>(null)
  const sliding = variant === "segmented" && props.type === "single"
  const attachRef = React.useCallback((node: HTMLDivElement | null) => {
    root.current = node
    if (typeof ref === "function") {
      const cleanup = ref(node)
      if (typeof cleanup === "function") return () => { root.current = null; cleanup() }
    } else if (ref) ref.current = node
  }, [ref])

  React.useLayoutEffect(() => {
    if (!sliding || !root.current) return
    const element = root.current
    const measure = () => {
      const selected = element.querySelector<HTMLElement>('[data-slot="toggle-group-item"][data-state="on"]')
      const box = selected?.getBoundingClientRect(), parent = element.getBoundingClientRect()
      const next = selected && selected.offsetWidth ? {
        x: box!.left - parent.left - element.clientLeft + element.scrollLeft, y: box!.top - parent.top - element.clientTop + element.scrollTop,
        width: box!.width, height: box!.height,
        radius: getComputedStyle(selected).borderRadius,
      } : null
      setIndicator(previous => previous?.x === next?.x && previous?.y === next?.y && previous?.width === next?.width && previous?.height === next?.height && previous?.radius === next?.radius ? previous : next)
    }
    const resize = new ResizeObserver(measure)
    const observeItems = () => {
      element.querySelectorAll('[data-slot="toggle-group-item"]').forEach(item => resize.observe(item))
      measure()
    }
    const mutations = new MutationObserver(observeItems)
    resize.observe(element)
    mutations.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] })
    observeItems()
    return () => { resize.disconnect(); mutations.disconnect() }
  }, [sliding])

  return (
    <ToggleGroupPrimitive.Root
      ref={attachRef}
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      data-indicator-ready={sliding && !!indicator || undefined}
      style={{ "--gap": spacing, ...style } as React.CSSProperties}
      className={cn(
        "group/toggle-group relative flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[variant=segmented]:bg-muted data-[variant=segmented]:p-1 data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      {sliding && indicator && <span
        data-slot="toggle-group-indicator"
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 bg-background shadow-sm"
        style={{ width: indicator.width, height: indicator.height, borderRadius: indicator.radius, transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)` }}
      />}
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }

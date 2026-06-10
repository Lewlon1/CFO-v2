import * as React from 'react'
import { cn } from '@/lib/utils'

// Office-idiom <select> — the one shared select primitive (replaces the inline,
// inconsistently-styled native selects across upload / onboarding / auth).
//
// rounded-control (8px) + subtle border on the elevated surface, text-sm, a 44px
// min touch target, and the browser's native dropdown arrow (no appearance-none).
// The focus ring matches the inline office fields (`focus:ring-text-primary/40`)
// rather than the shared focus-visible ring used by Input/Button — deliberately,
// so the office selects it consolidates look identical after the swap.
//
// Background defaults to bg-bg-elevated; pass another bg-* via className to swap
// surface (e.g. `bg-bg-base`) — twMerge dedupes the conflicting utility so the
// override wins. Other call-site layout (flex-1, mt-1, …) composes via className.
const selectBase =
  'w-full min-h-[44px] rounded-control border border-border-subtle bg-bg-elevated px-2 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/40'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(selectBase, className)} {...props} />
  ),
)
Select.displayName = 'Select'

export { Select }

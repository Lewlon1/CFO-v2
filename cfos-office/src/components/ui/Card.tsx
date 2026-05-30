import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRing } from './focus'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Surface tier. `default` = shadcn card tokens; `elevated`/`inset` = office tokens. */
  variant?: 'default' | 'elevated' | 'inset'
  /** Adds hover/active/focus affordances for clickable cards (tap = background shift, not opacity). */
  interactive?: boolean
}

/**
 * Card — the canonical surface primitive (Visual Phase 2b).
 * Replaces inline `rounded-… border… bg-…` container blocks. Reads only tokens +
 * the Phase-2a radii scale (`rounded-card`); zero raw hex/px. Consumers compose
 * their own internal layout, as the existing bespoke cards do.
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-card border',
        {
          'border-border bg-card text-card-foreground': variant === 'default',
          'border-border-medium bg-bg-elevated text-text-primary': variant === 'elevated',
          'border-border-subtle bg-bg-inset text-text-primary': variant === 'inset',
        },
        interactive &&
          cn(
            'cursor-pointer transition-colors hover:border-border-visible active:bg-tap-highlight',
            focusRing,
          ),
        className,
      )}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

export { Card }

'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRing } from './focus'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  /** Shows a spinner, sets aria-busy, and disables the button. */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'default', size = 'default', loading = false, disabled, children, ...props },
    ref,
  ) => {
    return (
      <button
        className={cn(
          // Tap states use a background shift, not opacity (UI-DIRECTION). Radius/size
          // tokens left as-is to avoid a cross-app visual shift; their migration to the
          // named scale is Phase 3. disabled:opacity-50 retained (faithful to prior look).
          'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
          focusRing,
          {
            'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80':
              variant === 'default',
            'border border-border bg-transparent hover:bg-accent hover:text-accent-foreground active:bg-accent/70':
              variant === 'outline',
            'hover:bg-accent hover:text-accent-foreground active:bg-accent/70': variant === 'ghost',
            'underline-offset-4 hover:underline active:opacity-80': variant === 'link',
          },
          {
            'h-10 px-4 py-2 text-sm': size === 'default',
            'h-8 px-3 text-xs': size === 'sm',
            'h-12 px-6 text-base': size === 'lg',
            'h-10 w-10': size === 'icon',
          },
          className,
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button }

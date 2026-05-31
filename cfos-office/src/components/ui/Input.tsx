import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRing } from './focus'

// 16px text (text-base) is intentional: it prevents iOS Safari's zoom-on-focus
// for sub-16px fields (mobile-first). min-h-11 = 44px tap target (Apple HIG).
// rounded-control = 8px. Error state via aria-invalid. Reads only tokens + scales.
const fieldBase =
  'w-full rounded-control border border-border bg-input px-3 py-2 text-base text-foreground placeholder:text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-[invalid=true]:border-destructive'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'min-h-11', focusRing, className)} {...props} />
))
Input.displayName = 'Input'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldBase, 'min-h-20 resize-y', focusRing, className)}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Input, Textarea }

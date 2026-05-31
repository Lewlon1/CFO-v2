import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Semantic/status tones only. Value-category tones (Foundation/Burden/Investment/
 * Leak) are deliberately NOT here yet — they require the canonical `--value-*`
 * tokens that Visual Phase 1 introduces; until then value pills stay on their
 * existing colour source. Add a `value` tone in Phase 1.
 */
export type BadgeTone = 'neutral' | 'gold' | 'positive' | 'negative' | 'info'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

/**
 * Badge / Pill — small inline label (Visual Phase 2b). `rounded-pill` (= full
 * round, identical to the inline `rounded-full` pills it replaces) + token
 * bg/text + `text-caption` (10px, matching the existing inline badges). Zero raw hex/px.
 */
const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone = 'neutral', ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption font-medium',
        {
          'bg-muted text-muted-foreground': tone === 'neutral',
          'bg-accent-gold-bg text-accent-gold': tone === 'gold',
          'bg-positive/10 text-positive': tone === 'positive',
          'bg-negative/10 text-negative': tone === 'negative',
          'bg-info/10 text-info': tone === 'info',
        },
        className,
      )}
      {...props}
    />
  ),
)
Badge.displayName = 'Badge'

export { Badge }

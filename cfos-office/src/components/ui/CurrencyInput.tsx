'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRing } from './focus'
import { moneySymbol, sanitizeMoneyInput, parseMoneyInput } from '@/lib/utils/money'

// Canonical currency input. Replaces the scattered `type="number"` money
// fields (processing-form, missing-costs, candidate-bills, chat StructuredInput)
// whose string state preserved leading zeros and let locale separators corrupt
// the value (e.g. "5.200" → 5.2). Uses type="text" + inputMode="decimal" and
// sanitises every keystroke through the shared money helpers, so what the user
// sees, what's stored, and what's parsed always agree.
//
// Reads only tokens + the shared Input scale (UI-DIRECTION lock compliant).
// 16px text avoids iOS zoom-on-focus; min-h-11 = 44px tap target.

const fieldBase =
  'w-full rounded-control border border-border bg-input pr-3 py-2 text-base text-foreground placeholder:text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-[invalid=true]:border-destructive'

export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  /** ISO currency code (e.g. "USD", "EUR") — drives the symbol adornment. */
  currency: string
  /** Controlled display string (sanitised). */
  value: string
  /** Fires with the sanitised display string on every change. */
  onChange: (display: string) => void
  /** Fires with the parsed numeric value (or null) on every change. */
  onValueChange?: (value: number | null) => void
}

const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ className, currency, value, onChange, onValueChange, ...props }, ref) => {
    const symbol = moneySymbol(currency)

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const display = sanitizeMoneyInput(e.target.value)
      onChange(display)
      onValueChange?.(parseMoneyInput(display))
    }

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {symbol}
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          className={cn(fieldBase, 'pl-8 min-h-11', focusRing, className)}
          {...props}
        />
      </div>
    )
  },
)
CurrencyInput.displayName = 'CurrencyInput'

export { CurrencyInput }

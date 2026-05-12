'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cfo-theme'

function readCurrent(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function applyTheme(next: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', next)
}

function subscribe(callback: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const getServerSnapshot = (): Theme => 'dark'

interface ThemeToggleProps {
  /**
   * Visual variant.
   *  - "default": the v4-style 40px circular icon button (used in the floating top-right and sidebar)
   *  - "row": a full-width inline control with a leading label, suitable for the Settings page
   */
  variant?: 'default' | 'row'
  className?: string
}

export function ThemeToggle({ variant = 'default', className }: ThemeToggleProps) {
  const theme = useSyncExternalStore(subscribe, readCurrent, getServerSnapshot)

  // SSR/hydration always start with the placeholder 'dark' snapshot — for
  // light-mode users that produces a one-frame Sun→Moon flicker (and on the
  // row variant a label flip) as the post-mount snapshot resolves. Gating
  // the icon/label on a mount flag suppresses the SSR icon entirely and
  // renders the correct one in the first client paint.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const toggle = useCallback(() => {
    const next: Theme = readCurrent() === 'light' ? 'dark' : 'light'
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore storage errors (private mode etc.)
    }
  }, [])

  const isLight = theme === 'light'
  const ariaLabel = isLight ? 'Switch to dark mode' : 'Switch to light mode'
  const Icon = isLight ? Moon : Sun

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        className={
          className ??
          'flex items-center justify-between w-full min-h-[44px] px-4 py-3 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-accent transition-colors'
        }
      >
        <span className="flex items-center gap-3">
          {mounted ? (
            <Icon size={16} aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="inline-block w-4 h-4" />
          )}
          <span>{mounted ? (isLight ? 'Light mode' : 'Dark mode') : 'Theme'}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {mounted ? (isLight ? 'Tap to switch to dark' : 'Tap to switch to light') : ''}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ariaLabel}
      className={
        className ??
        'inline-flex items-center justify-center w-10 h-10 rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors'
      }
    >
      {mounted ? (
        <Icon size={18} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="inline-block w-[18px] h-[18px]" />
      )}
    </button>
  )
}

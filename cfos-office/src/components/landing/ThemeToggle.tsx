'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cfo-landing-theme'

function getRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('.landing-v4')
}

function readCurrent(): Theme {
  const root = getRoot()
  return root?.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function applyTheme(next: Theme) {
  const root = getRoot()
  if (root) root.setAttribute('data-theme', next)
}

function subscribe(callback: () => void): () => void {
  const root = getRoot()
  if (!root || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(callback)
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const getServerSnapshot = (): Theme => 'dark'

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readCurrent, getServerSnapshot)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(STORAGE_KEY)) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => {
      applyTheme(e.matches ? 'light' : 'dark')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
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

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className="v4-toggle"
    >
      {isLight ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    </button>
  )
}

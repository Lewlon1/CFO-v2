'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, Sparkles } from 'lucide-react'

export type TimelineEntry = {
  version: number | null
  name: string
  subtitle: string | null
  traits: string[]
  archived_at: string | null
  isCurrent: boolean
}

type ArchetypeData = {
  archetype_name: string | null
  archetype_subtitle: string | null
  full_analysis: string | null
  certainty_areas: string[] | null
  conflict_areas: string[] | null
  comfort_patterns: string[] | null
  session_number: number | null
  updated_at: string | null
  shift_narrative: string | null
}

export function ArchetypePageClient({
  data,
  timeline,
  pendingRegen,
}: {
  data: ArchetypeData | null
  timeline: TimelineEntry[]
  pendingRegen: boolean
}) {
  const router = useRouter()
  const pollCountRef = useRef(0)
  const mountedVersionRef = useRef<number | null>(data?.session_number ?? null)
  const mountedUpdatedRef = useRef<string | null>(data?.updated_at ?? null)

  useEffect(() => {
    if (!pendingRegen) return
    const id = window.setInterval(() => {
      pollCountRef.current += 1
      if (pollCountRef.current > 20) {
        window.clearInterval(id)
        return
      }
      router.refresh()
    }, 3000)
    return () => window.clearInterval(id)
  }, [pendingRegen, router])

  // When a fresh server payload arrives showing the archetype has advanced past
  // what we mounted with, stop the banner from flashing on subsequent refreshes.
  const hasAdvanced =
    (data?.session_number ?? 0) > (mountedVersionRef.current ?? 0) ||
    (data?.updated_at && data.updated_at !== mountedUpdatedRef.current)

  if (!data || !data.archetype_name) {
    if (pendingRegen) {
      return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto">
          <h1 className="text-xl font-semibold text-foreground mb-6">Your Money Personality</h1>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-center space-y-4">
            <Sparkles className="h-8 w-8 text-amber-400 mx-auto animate-pulse" />
            <p className="text-sm text-foreground font-medium">
              Building your money personality…
            </p>
            <p className="text-sm text-muted-foreground">
              Your CFO is analysing your answers. This takes about a minute.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-foreground mb-6">Your Money Personality</h1>
        <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
          <p className="text-3xl">🧬</p>
          <p className="text-sm text-foreground font-medium">
            Discover your money personality
          </p>
          <p className="text-sm text-muted-foreground">
            Take the Value Map — a 2-minute exercise that reveals how you really
            feel about your spending.
          </p>
          <Link
            href="/value-map?mode=personal&return=archetype"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors min-h-[44px]"
          >
            Start the Value Map
          </Link>
        </div>
      </div>
    )
  }

  const newestFirst = [...timeline].reverse()
  const showShiftCallout =
    Boolean(data.shift_narrative) && timeline.length > 1 && !pendingRegen

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      {/* Hero */}
      <div>
        <p className="text-sm text-muted-foreground mb-1">Your money personality</p>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground">{data.archetype_name}</h1>
          {data.session_number != null && (
            <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
              v{data.session_number}
            </span>
          )}
        </div>
        {data.archetype_subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{data.archetype_subtitle}</p>
        )}
        {data.updated_at && (
          <p className="text-xs text-muted-foreground mt-1">
            Updated {formatRelative(data.updated_at)}
          </p>
        )}
      </div>

      {/* Pending regeneration banner */}
      {pendingRegen && !hasAdvanced && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
          <p className="text-sm text-foreground">
            Regenerating your archetype from your latest answers…
          </p>
        </div>
      )}

      {/* What changed callout */}
      {showShiftCallout && data.shift_narrative && (
        <div className="rounded-xl border-l-2 border-primary bg-card p-4 space-y-1">
          <p className="text-xs text-primary font-medium uppercase tracking-wide">What changed</p>
          <p className="text-sm text-foreground leading-relaxed">{data.shift_narrative}</p>
        </div>
      )}

      {/* Full analysis — traits stored as JSON array or plain text */}
      {data.full_analysis && (() => {
        let lines: string[] | null = null
        try {
          const parsed = JSON.parse(data.full_analysis!)
          if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
            lines = parsed
          }
        } catch { /* plain text — fall through */ }

        return lines ? (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-medium text-foreground">Analysis</h2>
            <ul className="space-y-2">
              {lines.map((line, i) => (
                <li key={i} className="text-sm text-muted-foreground leading-relaxed flex items-start gap-2">
                  <span className="text-muted-foreground mt-0.5 shrink-0">·</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-medium text-foreground">Analysis</h2>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {data.full_analysis}
            </p>
          </div>
        )
      })()}

      {/* Certainty areas */}
      {data.certainty_areas && data.certainty_areas.length > 0 && (
        <div className="rounded-xl border-l-2 border-emerald-500 bg-card p-4 space-y-2">
          <h2 className="text-sm font-medium text-emerald-400">Where you&apos;re certain</h2>
          <ul className="space-y-1.5">
            {data.certainty_areas.map((area, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-emerald-500 mt-0.5 shrink-0">+</span>
                {area}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conflict areas */}
      {data.conflict_areas && data.conflict_areas.length > 0 && (
        <div className="rounded-xl border-l-2 border-amber-500 bg-card p-4 space-y-2">
          <h2 className="text-sm font-medium text-amber-400">Where you&apos;re conflicted</h2>
          <ul className="space-y-1.5">
            {data.conflict_areas.map((area, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-amber-500 mt-0.5 shrink-0">~</span>
                {area}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Evolution timeline */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Evolution</h2>
          <p className="text-xs text-muted-foreground">
            How your money personality has shifted as your CFO has learned more.
          </p>
        </div>

        {timeline.length <= 1 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-4">
            <p className="text-sm text-muted-foreground">
              Your personality will evolve as you classify more transactions with
              your CFO. Come back after your next value map.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {newestFirst.map((entry, i) => (
              <TimelineItem
                key={`${entry.version ?? 'v'}-${i}`}
                entry={entry}
                defaultOpen={entry.isCurrent}
              />
            ))}
          </ol>
        )}
      </div>

      {/* Retake */}
      <div className="pt-2">
        <Link
          href="/value-map?mode=personal&return=archetype"
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-muted transition-colors min-h-[44px]"
        >
          Retake the Value Map
        </Link>
      </div>
    </div>
  )
}

function TimelineItem({
  entry,
  defaultOpen,
}: {
  entry: TimelineEntry
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const borderClass = entry.isCurrent
    ? 'border-primary/40 bg-card'
    : 'border-border bg-card/60'

  return (
    <li className={`rounded-xl border ${borderClass}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left p-3 flex items-start gap-3 min-h-[44px]"
        aria-expanded={open}
      >
        <div className="flex flex-col items-center pt-0.5 shrink-0 w-8">
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              entry.isCurrent
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            v{entry.version ?? '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{entry.name}</p>
            {entry.isCurrent && (
              <span className="text-[10px] text-primary uppercase tracking-wide">now</span>
            )}
          </div>
          {entry.subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.subtitle}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            {entry.isCurrent ? 'Current · ' : ''}
            {formatRelative(entry.archived_at)}
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground shrink-0 mt-1 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && entry.traits.length > 0 && (
        <ul className="px-3 pb-3 pl-14 space-y-1">
          {entry.traits.map((t, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
              <span className="text-muted-foreground mt-0.5 shrink-0">·</span>
              {t}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  const yr = Math.round(mo / 12)
  return `${yr}y ago`
}

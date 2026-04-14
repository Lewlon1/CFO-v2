'use client'

import Link from 'next/link'

type ArchetypeData = {
  archetype_name: string | null
  archetype_subtitle: string | null
  full_analysis: string | null
  certainty_areas: string[] | null
  conflict_areas: string[] | null
  comfort_patterns: string[] | null
}

export function ArchetypePageClient({ data }: { data: ArchetypeData | null }) {
  if (!data || !data.archetype_name) {
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
            href="/value-map?mode=retake"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            Start the Value Map
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      {/* Hero */}
      <div>
        <p className="text-sm text-muted-foreground mb-1">Your money personality</p>
        <h1 className="text-2xl font-bold text-foreground">{data.archetype_name}</h1>
        {data.archetype_subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{data.archetype_subtitle}</p>
        )}
      </div>

      {/* Full analysis */}
      {data.full_analysis && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium text-foreground">Analysis</h2>
          <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
            {data.full_analysis}
          </div>
        </div>
      )}

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

      {/* Comfort patterns */}
      {data.comfort_patterns && data.comfort_patterns.length > 0 && (
        <div className="rounded-xl border-l-2 border-cyan-500 bg-card p-4 space-y-2">
          <h2 className="text-sm font-medium text-cyan-400">Comfort patterns</h2>
          <ul className="space-y-1.5">
            {data.comfort_patterns.map((pattern, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-cyan-500 mt-0.5 shrink-0">*</span>
                {pattern}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Retake */}
      <div className="pt-2">
        <Link
          href="/value-map?mode=retake"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Retake the Value Map
        </Link>
      </div>
    </div>
  )
}

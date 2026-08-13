import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { folderColors } from '@/lib/tokens'
import { MEMORY_FOLDER_ROUTES, type MemoryFolder } from '@/lib/memory/constants'
import { formatRelativeAge, type MemoryFileSummary } from '@/lib/memory/files'

interface FileRowProps {
  folder: MemoryFolder
  file: MemoryFileSummary
  /** Position in the list — drives the 60ms staggered entrance. */
  index?: number
  /** Injected clock, so the row is assertable in tests. */
  now?: Date
}

/**
 * One row in a folder's Files list — UI-DIRECTION.md §File Rows.
 *
 * The type-line is the provenance line in miniature: what kind of thing this is,
 * how old it is, and whether the user has taken it over. That last part is the
 * whole trust story of the filing cabinet in three words, so it is on the row
 * rather than one tap away.
 *
 * Radius is `rounded-control` (8px), not the 10px the spec originally asked for:
 * arbitrary radii of 4px and up are an ESLint error (cfo/visual-token-guards),
 * and DrillDownRow already renders this row shape at 8px.
 */
export function FileRow({ folder, file, index = 0, now }: FileRowProps) {
  const accentColor = folderColors[folder]
  const age = formatRelativeAge(file.updated_at, now ?? new Date())

  // 'system' rows are the CFO's composed documents — Reads, monthly reviews,
  // the derived digests. Everything else is a note written in conversation.
  const kind = file.source === 'system' ? 'Document' : 'Note'

  const typeLine = [
    file.pinned ? 'Pinned' : null,
    kind,
    `Updated ${age}`,
    file.user_edited_at ? 'Edited by you' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      href={`/office/${MEMORY_FOLDER_ROUTES[folder]}/files/${file.slug}`}
      className="flex items-center gap-3 min-h-11 px-[14px] py-3 rounded-control border border-border-subtle bg-bg-card transition-colors hover:bg-tap-highlight active:bg-bg-inset animate-fade-in"
      style={{ opacity: 0, animationDelay: `${index * 60}ms` }}
    >
      <span
        className="text-[13px] w-[18px] text-center shrink-0"
        style={{ color: accentColor }}
        aria-hidden="true"
      >
        {file.pinned ? '★' : '▤'}
      </span>

      <div className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold text-text-primary truncate">
          {file.title}
        </span>
        {file.description && (
          <span className="block text-[11px] text-text-tertiary mt-[2px] line-clamp-1">
            {file.description}
          </span>
        )}
        <span className="block font-data text-[9px] tracking-[0.08em] uppercase text-text-muted mt-[3px]">
          {typeLine}
        </span>
      </div>

      <ChevronRight
        size={14}
        className="shrink-0 text-text-primary"
        style={{ opacity: 0.15 }}
        strokeWidth={1.5}
      />
    </Link>
  )
}

export default FileRow

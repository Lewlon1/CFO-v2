import Link from 'next/link'
import { colors } from '@/lib/tokens'

interface FolderSectionProps {
  icon: React.ReactNode
  label: string
  subtitle: string
  fileCount?: number
  accentColor: string
  openHref: string
  children: React.ReactNode
}

export function FolderSection({
  icon,
  label,
  subtitle,
  fileCount,
  accentColor,
  openHref,
  children,
}: FolderSectionProps) {
  return (
    <div className="mb-6">
      {/* Folder tab — floats above card */}
      <div
        className="inline-flex items-center gap-1.5 py-[5px] px-3 rounded-t-control ml-3 relative z-[1] -mb-px text-body font-bold"
        style={{
          color: accentColor,
          backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
        }}
      >
        <span className="shrink-0">{icon}</span>
        <span>{label}</span>
        {fileCount != null && (
          <span
            className="font-data text-caption px-1.5 py-0.5 rounded-sm ml-0.5"
            style={{
              color: accentColor,
              backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
            }}
          >
            {fileCount}
          </span>
        )}
      </div>

      {/* Folder body */}
      <div
        className="overflow-hidden"
        style={{
          borderRadius: '4px 14px 14px 14px',
          border: `1px solid `,
          borderLeft: `2px solid color-mix(in srgb, ${accentColor} 20%, transparent)`,
          backgroundColor: colors.bgCard,
        }}
      >
        {/* Subtitle */}
        <p className="px-3.5 pt-3.5 text-caption text-text-tertiary">{subtitle}</p>

        {/* Content */}
        <div className="px-3.5 pb-3.5">
          {children}
        </div>

        {/* Open link */}
        <Link
          href={openHref}
          className="flex items-center justify-end gap-1 min-h-11 px-3.5 border-t text-label font-semibold transition-colors hover:bg-tap-highlight"
          style={{
            color: accentColor,
            borderColor: colors.tapHighlight,
          }}
        >
          Open {label} <span style={{ opacity: 0.5 }}>&rsaquo;</span>
        </Link>
      </div>
    </div>
  )
}

export default FolderSection

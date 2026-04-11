import Link from 'next/link'

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
    <div className="relative" style={{ paddingTop: '28px' }}>
      {/* Folder tab — positioned above card */}
      <div
        className="absolute top-0 left-4 flex items-center gap-1.5 px-3 h-7 rounded-t-[10px]"
        style={{
          color: accentColor,
          backgroundColor: `color-mix(in srgb, ${accentColor} 12%, var(--bg-elevated))`,
          borderTop: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
          borderLeft: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
          borderRight: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
        }}
      >
        {/* Icon container — 20x20, radius 5 */}
        <span
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded-[5px]"
          style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 18%, transparent)` }}
        >
          {icon}
        </span>
        <span className="text-[13px] font-bold">{label}</span>
        {fileCount != null && (
          <span
            className="font-data text-[10px] px-1.5 py-0.5 rounded-sm ml-0.5"
            style={{
              color: accentColor,
              backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
            }}
          >
            {fileCount}
          </span>
        )}
      </div>

      {/* Folder body — 4px top-left (tab join), 14px elsewhere */}
      <div
        className="bg-bg-elevated overflow-hidden"
        style={{
          borderRadius: '4px 14px 14px 14px',
          border: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
        }}
      >
        {/* Subtitle */}
        <p className="px-3.5 pt-3 pb-3 text-[10px] text-text-tertiary">{subtitle}</p>

        {/* Content */}
        <div className="px-3.5 pb-3.5">
          {children}
        </div>

        {/* Open link */}
        <Link
          href={openHref}
          className="flex items-center justify-center min-h-[44px] border-t text-[11px] font-semibold transition-colors hover:bg-tap-highlight"
          style={{
            color: accentColor,
            borderColor: `color-mix(in srgb, ${accentColor} 10%, transparent)`,
          }}
        >
          Open {label} &rarr;
        </Link>
      </div>
    </div>
  )
}

export default FolderSection

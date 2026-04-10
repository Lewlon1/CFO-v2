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
    <div
      className="rounded-lg bg-office-bg-secondary overflow-hidden"
      style={{ border: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)` }}
    >
      {/* Tab header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="text-base shrink-0" style={{ color: accentColor }}>{icon}</span>
        <span className="font-medium text-sm text-office-text">{label}</span>
        {fileCount != null && (
          <span
            className="font-data text-[10px] px-1.5 py-0.5 rounded-sm"
            style={{
              color: accentColor,
              backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
            }}
          >
            {fileCount}
          </span>
        )}
      </div>

      {/* Subtitle */}
      <p className="px-4 pb-3 text-sm text-office-text-secondary">{subtitle}</p>

      {/* Content */}
      <div className="px-4 pb-4">
        {children}
      </div>

      {/* Open link */}
      <Link
        href={openHref}
        className="flex items-center justify-center min-h-[44px] border-t text-sm font-medium transition-colors hover:bg-office-bg-tertiary"
        style={{
          color: accentColor,
          borderColor: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
        }}
      >
        Open {label} &rarr;
      </Link>
    </div>
  )
}

export default FolderSection

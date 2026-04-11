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
    <div className="relative pt-7">
      {/* Folder tab */}
      <div
        className="absolute top-0 left-4 flex items-center gap-1.5 px-3 h-7 rounded-t-lg text-sm font-medium"
        style={{
          color: accentColor,
          backgroundColor: `color-mix(in srgb, ${accentColor} 12%, var(--office-bg-secondary))`,
          borderTop: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
          borderLeft: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
          borderRight: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
        }}
      >
        <span className="shrink-0">{icon}</span>
        <span>{label}</span>
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

      {/* Folder body */}
      <div
        className="rounded-lg rounded-tl-none bg-office-bg-secondary overflow-hidden"
        style={{
          border: `1px solid color-mix(in srgb, ${accentColor} 30%, transparent)`,
        }}
      >
        {/* Subtitle */}
        <p className="px-4 pt-3 pb-3 text-sm text-office-text-secondary">{subtitle}</p>

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
    </div>
  )
}

export default FolderSection

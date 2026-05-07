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
    <div className="mb-6">
      {/* Folder tab — floats above card */}
      <div
        className="inline-flex items-center gap-1.5 py-[5px] px-[12px] rounded-t-[8px] ml-3 relative z-[1] -mb-px text-[13px] font-bold"
        style={{
          color: accentColor,
          backgroundColor: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
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
        className="overflow-hidden"
        style={{
          borderRadius: '4px 14px 14px 14px',
          border: `1px solid rgba(255,255,255,0.04)`,
          borderLeft: `2px solid color-mix(in srgb, ${accentColor} 20%, transparent)`,
          backgroundColor: 'rgba(255,255,255,0.015)',
        }}
      >
        {/* Subtitle */}
        <p className="px-[14px] pt-[14px] text-[10px] text-[rgba(245,245,240,0.3)]">{subtitle}</p>

        {/* Content */}
        <div className="px-[14px] pb-[14px]">
          {children}
        </div>

        {/* Open link */}
        <Link
          href={openHref}
          className="flex items-center justify-end gap-1 min-h-[44px] px-[14px] border-t text-[11px] font-semibold transition-colors hover:bg-[rgba(255,255,255,0.03)]"
          style={{
            color: accentColor,
            borderColor: 'rgba(255,255,255,0.03)',
          }}
        >
          Open {label} <span style={{ opacity: 0.5 }}>&rsaquo;</span>
        </Link>
      </div>
    </div>
  )
}

export default FolderSection

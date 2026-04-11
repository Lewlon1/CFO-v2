'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useTrackEvent } from '@/lib/events/use-track-event'

export interface FileItem {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  badge?: 'dashboard' | 'chart' | 'list' | 'insight' | 'tool'
  href: string
}

interface FolderDetailProps {
  icon: React.ReactNode
  label: string
  subtitle: string
  files: FileItem[]
}

const BADGE_STYLES: Record<string, string> = {
  dashboard: 'bg-office-bg-tertiary text-office-text-muted',
  chart: 'bg-office-bg-tertiary text-office-text-muted',
  list: 'bg-office-bg-tertiary text-office-text-muted',
  insight: 'bg-office-bg-tertiary text-office-text-muted',
  tool: 'bg-office-bg-tertiary text-office-text-muted',
}

export function FolderDetail({ icon, label, subtitle, files }: FolderDetailProps) {
  const trackEvent = useTrackEvent()

  useEffect(() => {
    trackEvent('folder_opened', 'engagement', { folder_id: label.toLowerCase().replace(/\s+/g, '-') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  return (
    <div className="flex flex-col gap-0 p-4">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-base shrink-0 text-text-secondary">{icon}</span>
        <span className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary">{label}</span>
      </div>
      <p className="text-[10px] text-text-tertiary mb-4">{subtitle}</p>

      {/* File list */}
      {files.length === 0 ? (
        <p className="text-[13px] text-text-tertiary py-6 text-center">
          No files in this folder yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {files.map((file, i) => (
            <li
              key={file.id}
              className="animate-fade-in"
              style={{
                animationDelay: `${i * 60}ms`,
              }}
            >
              <Link
                href={file.href}
                className="flex items-center gap-3 min-h-[48px] p-3.5 rounded-[10px] border border-border-subtle transition-colors hover:bg-tap-highlight active:bg-bg-inset"
              >
                <span className="text-[13px] w-[18px] text-center shrink-0 text-text-tertiary">{file.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-text-primary">{file.label}</span>
                  <span className="block font-data text-[9px] text-text-muted truncate">{file.description}</span>
                </div>
                {file.badge && (
                  <span className={`shrink-0 font-data text-[9px] px-1.5 py-0.5 rounded ${BADGE_STYLES[file.badge]}`}>
                    {file.badge}
                  </span>
                )}
                <ChevronRight size={14} className="shrink-0 opacity-[0.15]" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

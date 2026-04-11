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
      {/* Header — matches FolderSection styling */}
      <div className="flex items-center gap-2.5 mb-1">
        <span className="text-base shrink-0 text-office-text-secondary">{icon}</span>
        <span className="font-medium text-sm text-office-text">{label}</span>
      </div>
      <p className="text-sm text-office-text-secondary mb-4">{subtitle}</p>

      {/* File list */}
      {files.length === 0 ? (
        <p className="text-sm text-office-text-muted py-6 text-center">
          No files in this folder yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {files.map((file, i) => (
            <li
              key={file.id}
              className="animate-fade-in"
              style={{
                animationDelay: `${i * 50}ms`,
              }}
            >
              <Link
                href={file.href}
                className="flex items-center gap-3 min-h-[48px] px-3 py-2.5 -mx-1 rounded-lg transition-colors hover:bg-office-bg-secondary active:bg-office-bg-tertiary"
              >
                <span className="text-office-text-muted shrink-0">{file.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-office-text">{file.label}</span>
                  <span className="block text-xs text-office-text-muted truncate">{file.description}</span>
                </div>
                {file.badge && (
                  <span className={`shrink-0 text-[10px] font-data px-1.5 py-0.5 rounded ${BADGE_STYLES[file.badge]}`}>
                    {file.badge}
                  </span>
                )}
                <ChevronRight size={16} className="shrink-0 text-office-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

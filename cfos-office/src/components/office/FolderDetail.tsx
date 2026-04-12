'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useTrackEvent } from '@/lib/events/use-track-event'

export interface FileItem {
  id: string
  label: string
  description: string
  icon: string  // text character, not React node
  href: string
}

interface FolderDetailProps {
  accentColor: string
  files: FileItem[]
}

export function FolderDetail({ accentColor, files }: FolderDetailProps) {
  const trackEvent = useTrackEvent()

  useEffect(() => {
    trackEvent('folder_opened', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="px-3.5 pt-2 pb-24">
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
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <Link
                href={file.href}
                className="flex items-center gap-[10px] min-h-[48px] p-3 rounded-[10px] border border-[rgba(255,255,255,0.04)] transition-colors hover:bg-[rgba(255,255,255,0.03)] active:bg-bg-inset"
              >
                <span
                  className="text-[12px] w-4 text-center shrink-0"
                  style={{ color: accentColor }}
                >
                  {file.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="block text-[12px] font-semibold text-text-primary">{file.label}</span>
                  <span className="block font-data text-[8px] text-[rgba(245,245,240,0.25)] mt-[1px]">{file.description}</span>
                </div>
                <span className="shrink-0 text-[13px] text-[rgba(245,245,240,0.12)]">&rsaquo;</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

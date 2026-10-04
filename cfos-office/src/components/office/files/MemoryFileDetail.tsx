'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Button } from '@/components/ui/button'
import { DetailHeader } from '@/components/office/dashboards/DetailHeader'
import { folderColors } from '@/lib/tokens'
import { MEMORY_FOLDER_ROUTES, MAX_CONTENT_CHARS, type MemoryFolder } from '@/lib/memory/constants'
import { formatRelativeAge, type MemoryFile } from '@/lib/memory/files'

interface MemoryFileDetailProps {
  folder: MemoryFolder
  file: MemoryFile
}

// The file body is the CFO's prose, so it reads in the Briefing's serif rather
// than the app's UI sans. Tailwind v4 here has no typography plugin — every
// element is styled explicitly, same as MessageList.
const markdownComponents: Components = {
  p: ({ children }) => <p className="my-2 leading-[1.5] first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.5]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h1 className="text-[17px] font-semibold mt-4 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[16px] font-semibold mt-4 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[15px] font-semibold mt-3 mb-1 first:mt-0">{children}</h3>,
  hr: () => <hr className="my-4 border-border-subtle" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-subtle pl-3 italic my-2">{children}</blockquote>
  ),
}

/** Who wrote it — in the user's language, never the mechanism's. */
function provenanceLine(file: MemoryFile, now: Date): string {
  const written = file.source === 'user'
    ? 'Written by you'
    : file.source === 'system'
      ? 'Composed by your CFO'
      : 'Noted by your CFO'

  return [
    written,
    `updated ${formatRelativeAge(file.updated_at, now)}`,
    file.user_edited_at ? 'edited by you' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function MemoryFileDetail({ folder, file }: MemoryFileDetailProps) {
  const router = useRouter()
  const accent = folderColors[folder]

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(file.content)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isArchived = file.archived_at !== null

  async function send(request: () => Promise<Response>, onDone?: () => void) {
    setBusy(true)
    setError(null)
    try {
      const res = await request()
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload.error ?? 'Something went wrong. Try again.')
        return
      }
      onDone?.()
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    send(
      () =>
        fetch(`/api/memory/files/${file.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: draft }),
        }),
      () => setIsEditing(false),
    )

  const act = (action: 'archive' | 'restore' | 'pin' | 'unpin') =>
    send(() =>
      fetch(`/api/memory/files/${file.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }),
    )

  return (
    <div className="px-3.5 pt-2 pb-24">
      <DetailHeader
        title={file.title}
        color={accent}
        backHref={`/office/${MEMORY_FOLDER_ROUTES[folder]}`}
      />

      <p className="font-data text-[9px] tracking-[0.08em] uppercase text-text-muted mb-3 px-0.5">
        {provenanceLine(file, new Date())}
      </p>

      {isArchived && (
        <p className="text-[12px] text-text-tertiary bg-bg-inset rounded-control px-3 py-2 mb-3">
          This file is archived. Your CFO can no longer see it.
        </p>
      )}

      {/* Same frame as the Briefing card — this is the CFO writing to the user. */}
      <div
        className="rounded-control px-[14px] py-[14px] mb-4"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, var(--text-primary) 2.5%, transparent) 0%, color-mix(in oklab, var(--text-primary) 1.5%, transparent) 100%)`,
          border: '0.5px solid var(--border-medium)',
          borderLeft: `2px solid ${accent}`,
        }}
      >
        {isEditing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_CONTENT_CHARS}
              rows={16}
              aria-label="File contents"
              // text-base = 16px: anything smaller and Safari zooms the page on focus.
              className="w-full bg-transparent text-base leading-[1.5] text-text-primary outline-none resize-y"
            />
            <p className="font-data text-[9px] tracking-[0.08em] uppercase text-text-muted mt-2">
              {draft.length} / {MAX_CONTENT_CHARS}
            </p>
          </>
        ) : (
          <div
            style={{
              fontFamily: 'var(--font-cormorant), Georgia, serif',
              fontSize: 16,
              color: 'var(--text-primary)',
            }}
          >
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {file.content}
            </Markdown>
          </div>
        )}
      </div>

      {error && <p className="text-[12px] text-negative mb-3">{error}</p>}

      {isEditing ? (
        <div className="flex gap-2">
          <Button onClick={save} loading={busy} disabled={draft.trim().length === 0}>
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDraft(file.content)
              setIsEditing(false)
              setError(null)
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsEditing(true)} disabled={busy || isArchived}>
            Edit
          </Button>
          <Button
            variant="outline"
            onClick={() => act(file.pinned ? 'unpin' : 'pin')}
            disabled={busy || isArchived}
          >
            {file.pinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant="outline"
            onClick={() => act(isArchived ? 'restore' : 'archive')}
            disabled={busy}
          >
            {isArchived ? 'Restore' : 'Archive'}
          </Button>
        </div>
      )}

      {!isEditing && !isArchived && (
        <p className="text-[11px] text-text-tertiary mt-4 leading-relaxed">
          Edit anything here and it becomes yours — your CFO will add to this file
          from then on, but never rewrite what you have written.
        </p>
      )}
    </div>
  )
}

export default MemoryFileDetail

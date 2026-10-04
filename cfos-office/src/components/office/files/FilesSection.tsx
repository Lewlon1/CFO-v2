import { createClient } from '@/lib/supabase/server'
import { DashboardEmptyState } from '@/components/office/dashboards/DashboardEmptyState'
import { listFolder } from '@/lib/memory/files'
import { MEMORY_FOLDER_LABELS, type MemoryFolder } from '@/lib/memory/constants'
import { FileRow } from './FileRow'

interface FilesSectionProps {
  folder: MemoryFolder
}

/**
 * The filing cabinet, made visible — the files the CFO keeps in this folder,
 * mounted below the folder's dashboard.
 *
 * This is the trust half of the memory feature: the CFO writes these rows
 * through tools, and the user opens the very same rows here. Nothing the CFO
 * remembers about them lives anywhere the user cannot see it.
 *
 * Server component. It does its own fetch rather than taking rows as props so
 * that mounting it on a folder page is a one-line change.
 */
export async function FilesSection({ folder }: FilesSectionProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const result = await listFolder(supabase, user.id, folder)

  // A failed read is not worth a scary empty state on someone's folder page —
  // the error is already logged in the data layer.
  if (!result.ok) return null

  const files = result.value
  const now = new Date()

  return (
    <section className="pt-2">
      <h2 className="font-data text-[8px] tracking-[0.08em] uppercase text-text-muted pb-2 px-1">
        Files
      </h2>

      {files.length === 0 ? (
        // No icon: this sits under a full dashboard on all four folders, and a
        // 40px glyph four times over is a lot of furniture for "nothing yet".
        <DashboardEmptyState
          body={`Nothing filed here yet. As you and your CFO talk, notes land in ${MEMORY_FOLDER_LABELS[folder]}.`}
        />
      ) : (
        <div className="space-y-2">
          {files.map((file, index) => (
            <FileRow
              key={file.slug}
              folder={folder}
              file={file}
              index={index}
              now={now}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default FilesSection

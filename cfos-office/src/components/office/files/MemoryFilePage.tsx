import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFile } from '@/lib/memory/files'
import type { MemoryFolder } from '@/lib/memory/constants'
import { MemoryFileDetail } from './MemoryFileDetail'

interface MemoryFilePageProps {
  folder: MemoryFolder
  slug: string
}

/**
 * The body of all four `/office/<folder>/files/[slug]` routes.
 *
 * The routes themselves stay four literal segments rather than one dynamic
 * `[folder]` — NavigationBar reads the folder colour off `segments[1]`, and a
 * dynamic segment would break that for every page under it.
 *
 * Archived files still resolve: their page is where the user restores them from.
 */
export async function MemoryFilePage({ folder, slug }: MemoryFilePageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const result = await getFile(supabase, user.id, folder, slug, { includeArchived: true })
  if (!result.ok || !result.value) notFound()

  return <MemoryFileDetail folder={folder} file={result.value} />
}

export default MemoryFilePage

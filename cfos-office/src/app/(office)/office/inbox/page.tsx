import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { InboxClient } from './InboxClient'

interface Nudge {
  id: string
  type: string
  title: string
  body: string
  action_url: string | null
  status: string
  read_at: string | null
  created_at: string
}

interface NudgeGroup {
  label: string
  nudges: Nudge[]
}

function groupByDate(nudges: Nudge[]): NudgeGroup[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  const groups: Record<string, Nudge[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    Earlier: [],
  }

  for (const nudge of nudges) {
    const created = new Date(nudge.created_at)
    if (created >= today) {
      groups['Today'].push(nudge)
    } else if (created >= yesterday) {
      groups['Yesterday'].push(nudge)
    } else if (created >= weekAgo) {
      groups['This week'].push(nudge)
    } else {
      groups['Earlier'].push(nudge)
    }
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, nudges: items }))
}

export default async function InboxPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: nudges } = await supabase
    .from('nudges')
    .select('id, type, title, body, action_url, status, read_at, created_at')
    .eq('user_id', user.id)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(50)

  const groups = groupByDate(nudges ?? [])
  const unreadCount = (nudges ?? []).filter((n) => !n.read_at).length

  return <InboxClient groups={groups} unreadCount={unreadCount} />
}

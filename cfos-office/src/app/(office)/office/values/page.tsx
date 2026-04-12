import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'

const files: FileItem[] = [
  {
    id: 'the-gap',
    label: 'The Gap',
    description: 'analysis · belief vs reality',
    icon: '◎',
    href: '/office/values/the-gap',
  },
  {
    id: 'value-split',
    label: 'Values breakdown',
    description: 'dashboard · this month',
    icon: '◈',
    href: '/office/values/value-split',
  },
  {
    id: 'portrait',
    label: 'Your archetype',
    description: 'profile · financial personality',
    icon: '☆',
    href: '/office/values/portrait',
  },
  {
    id: 'profile',
    label: 'What your CFO knows',
    description: 'transparency · view & edit',
    icon: '◇',
    href: '/office/values/portrait',
  },
]

export default function ValuesPage() {
  return <FolderDetail accentColor="#E8A84C" files={files} />
}

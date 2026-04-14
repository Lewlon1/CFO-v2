import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'

const files: FileItem[] = [
  {
    id: 'what-if',
    label: 'What If',
    description: 'model financial decisions',
    icon: '⊗',
    href: '/office/scenarios/what-if',
  },
  {
    id: 'trips',
    label: 'Trip planning',
    description: 'plan and budget trips',
    icon: '✈',
    href: '/office/scenarios/trips',
  },
  {
    id: 'goals',
    label: 'Goals',
    description: 'track financial goals',
    icon: '◎',
    href: '/office/scenarios/goals',
  },
]

export default function ScenariosPage() {
  return <FolderDetail accentColor="#F43F5E" files={files} />
}

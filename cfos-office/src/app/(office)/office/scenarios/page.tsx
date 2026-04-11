import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'
import {
  Sparkles,
  Plane,
} from 'lucide-react'

const files: FileItem[] = [
  {
    id: 'what-if',
    label: 'What If',
    description: 'Model financial decisions',
    icon: <Sparkles size={18} />,
    badge: 'tool',
    href: '/office/scenarios/what-if',
  },
  {
    id: 'trips',
    label: 'Trip Planning',
    description: 'Plan and budget trips',
    icon: <Plane size={18} />,
    badge: 'tool',
    href: '/office/scenarios/trips',
  },
]

export default function ScenariosPage() {
  return (
    <FolderDetail
      icon={<span className="text-[var(--office-gold)]">&#10024;</span>}
      label="Scenarios"
      subtitle="Model decisions and plan adventures"
      files={files}
    />
  )
}

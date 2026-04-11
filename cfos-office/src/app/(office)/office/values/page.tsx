import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'
import {
  LayoutDashboard,
  Sparkles,
  User,
  Download,
} from 'lucide-react'

const files: FileItem[] = [
  {
    id: 'value-split',
    label: 'Value Split',
    description: 'Foundation, Investment, Leak, Burden',
    icon: <LayoutDashboard size={18} />,
    badge: 'dashboard',
    href: '/office/values/value-split',
  },
  {
    id: 'the-gap',
    label: 'The Gap',
    description: 'What you say vs what you spend',
    icon: <Sparkles size={18} />,
    badge: 'insight',
    href: '/office/values/the-gap',
  },
  {
    id: 'portrait',
    label: 'Financial Portrait',
    description: 'What your CFO knows about you',
    icon: <User size={18} />,
    badge: 'dashboard',
    href: '/office/values/portrait',
  },
  {
    id: 'export',
    label: 'Export Data',
    description: 'Download your financial data',
    icon: <Download size={18} />,
    badge: 'tool',
    href: '/office/values/export',
  },
]

export default function ValuesPage() {
  return (
    <FolderDetail
      icon={<span className="text-[var(--office-cyan,#06B6D4)]">&#9829;</span>}
      label="Values"
      subtitle="Understand your relationship with money"
      files={files}
    />
  )
}

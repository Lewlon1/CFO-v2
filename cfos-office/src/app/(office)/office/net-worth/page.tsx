import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'

const files: FileItem[] = [
  {
    id: 'balance-sheet',
    label: 'Balance Sheet',
    description: 'Assets and liabilities overview',
    icon: <LayoutDashboard size={18} />,
    badge: 'dashboard',
    href: '/office/net-worth/balance-sheet',
  },
  {
    id: 'assets',
    label: 'Assets',
    description: 'Everything you own',
    icon: <TrendingUp size={18} />,
    badge: 'list',
    href: '/office/net-worth/assets',
  },
  {
    id: 'liabilities',
    label: 'Liabilities',
    description: 'Everything you owe',
    icon: <TrendingDown size={18} />,
    badge: 'list',
    href: '/office/net-worth/liabilities',
  },
]

export default function NetWorthPage() {
  return (
    <FolderDetail
      icon={<span className="text-[var(--office-purple,#A855F7)]">&#9878;</span>}
      label="Net Worth"
      subtitle="Assets, liabilities, and your balance sheet"
      files={files}
    />
  )
}

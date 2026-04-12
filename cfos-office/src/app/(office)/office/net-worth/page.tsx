import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'

const files: FileItem[] = [
  {
    id: 'balance-sheet',
    label: 'Balance sheet',
    description: 'assets & liabilities overview',
    icon: '◉',
    href: '/office/net-worth/balance-sheet',
  },
  {
    id: 'assets',
    label: 'Assets',
    description: 'everything you own',
    icon: '▲',
    href: '/office/net-worth/assets',
  },
  {
    id: 'liabilities',
    label: 'Liabilities',
    description: 'everything you owe',
    icon: '▼',
    href: '/office/net-worth/liabilities',
  },
]

export default function NetWorthPage() {
  return <FolderDetail accentColor="#06B6D4" files={files} />
}

import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'

const files: FileItem[] = [
  {
    id: 'monthly-overview',
    label: 'Monthly overview',
    description: 'dashboard · this month',
    icon: '◉',
    href: '/office/cash-flow/monthly-overview',
  },
  {
    id: 'transactions',
    label: 'Transactions',
    description: 'list · all items',
    icon: '≡',
    href: '/office/cash-flow/transactions',
  },
  {
    id: 'bills',
    label: 'Bills & subscriptions',
    description: 'tracker · known providers',
    icon: '↻',
    href: '/office/cash-flow/bills',
  },
  {
    id: 'patterns',
    label: 'Spending patterns',
    description: 'insights · regular habits',
    icon: '◈',
    href: '/office/cash-flow/patterns',
  },
  {
    id: 'upload',
    label: 'Upload statement',
    description: 'action · csv / screenshot',
    icon: '⊕',
    href: '/office/cash-flow/upload',
  },
  {
    id: 'spending-breakdown',
    label: 'Spending breakdown',
    description: 'dashboard · by category',
    icon: '⊞',
    href: '/office/cash-flow/spending-breakdown',
  },
]

export default function CashFlowPage() {
  return <FolderDetail accentColor="#22C55E" files={files} />
}

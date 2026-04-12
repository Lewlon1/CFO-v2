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
    label: 'Recurring expenses',
    description: 'tracker · detected charges',
    icon: '↻',
    href: '/office/cash-flow/bills',
  },
  {
    id: 'upload',
    label: 'Upload statement',
    description: 'action · csv / screenshot',
    icon: '⊕',
    href: '/chat?prefill=I%27d+like+to+upload+a+bank+statement',
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

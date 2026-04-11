import { FolderDetail } from '@/components/office/FolderDetail'
import type { FileItem } from '@/components/office/FolderDetail'
import {
  LayoutDashboard,
  PieChart,
  TrendingUp,
  Receipt,
  Wrench,
  List,
} from 'lucide-react'

const files: FileItem[] = [
  {
    id: 'monthly-overview',
    label: 'Monthly Overview',
    description: 'Income, spending, and surplus',
    icon: <LayoutDashboard size={18} />,
    badge: 'dashboard',
    href: '/office/cash-flow/monthly-overview',
  },
  {
    id: 'spending-breakdown',
    label: 'Spending Breakdown',
    description: 'Category-by-category analysis',
    icon: <PieChart size={18} />,
    badge: 'chart',
    href: '/office/cash-flow/spending-breakdown',
  },
  {
    id: 'trends',
    label: 'Trends',
    description: 'Month-over-month patterns',
    icon: <TrendingUp size={18} />,
    badge: 'chart',
    href: '/office/cash-flow/trends',
  },
  {
    id: 'bills',
    label: 'Bills & Recurring',
    description: 'Your recurring charges',
    icon: <Receipt size={18} />,
    badge: 'list',
    href: '/office/cash-flow/bills',
  },
  {
    id: 'optimise',
    label: 'Optimise',
    description: 'Find savings on bills',
    icon: <Wrench size={18} />,
    badge: 'tool',
    href: '/office/cash-flow/optimise',
  },
  {
    id: 'transactions',
    label: 'Transactions',
    description: 'Full transaction history',
    icon: <List size={18} />,
    badge: 'list',
    href: '/office/cash-flow/transactions',
  },
]

export default function CashFlowPage() {
  return (
    <FolderDetail
      icon={<span className="text-[var(--office-green)]">$</span>}
      label="Cash Flow"
      subtitle="Track income, spending, and recurring charges"
      files={files}
    />
  )
}

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
  return (
    <>
      <div className="mx-3.5 mt-1 mb-3 px-3 py-2.5 rounded-[10px] bg-[rgba(6,182,212,0.06)] border border-[rgba(6,182,212,0.15)] text-[12px] text-text-secondary leading-relaxed">
        Tip: you can tell your CFO about assets and liabilities directly in chat.
        Try <span className="text-text-primary">&ldquo;I have a savings account with £5,000&rdquo;</span> or{' '}
        <span className="text-text-primary">&ldquo;I owe £12,000 on my car loan&rdquo;</span>.
      </div>
      <FolderDetail accentColor="#06B6D4" files={files} />
    </>
  )
}

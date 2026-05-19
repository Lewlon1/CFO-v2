import { GoalsEmptyStateCTA } from '@/app/(office)/office/goals/GoalsEmptyStateCTA'

export function GoalsEmptyState() {
  return (
    <div className="flex flex-col items-start gap-2 pt-1">
      <p className="text-[13px] font-semibold text-text-primary">No goal set.</p>
      <p className="text-[12px] text-text-secondary">
        Your CFO can&apos;t advise on a destination you haven&apos;t named.
      </p>
      <div className="pt-1">
        <GoalsEmptyStateCTA />
      </div>
    </div>
  )
}

export default GoalsEmptyState

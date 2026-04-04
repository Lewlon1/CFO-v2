import useSWR from 'swr'
import { fetcher } from './fetcher'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

export function useDashboardData(month?: string) {
  const params = month ? `?month=${month}` : ''
  const { data, error, isLoading } = useSWR<DashboardSummary>(
    `/api/dashboard/summary${params}`,
    fetcher
  )

  return { summary: data, isLoading, error }
}

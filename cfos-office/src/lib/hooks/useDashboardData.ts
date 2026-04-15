import useSWR from 'swr'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

async function dashboardFetcher(url: string): Promise<DashboardSummary | null> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch')
  const json = await res.json()
  // API returns { hasData: false } when monthly_snapshots is empty
  if ('hasData' in json && json.hasData === false) return null
  return json as DashboardSummary
}

export function useDashboardData(month?: string) {
  const params = month ? `?month=${month}` : ''
  const { data, error, isLoading } = useSWR<DashboardSummary | null>(
    `/api/dashboard/summary${params}`,
    dashboardFetcher,
  )

  return { summary: data ?? undefined, isLoading, error }
}

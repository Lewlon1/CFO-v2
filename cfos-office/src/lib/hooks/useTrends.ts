import useSWR from 'swr'
import { fetcher } from './fetcher'
import type { TrendsResponse } from '@/app/api/dashboard/trends/route'

export function useTrends(months = 6) {
  const { data, error, isLoading } = useSWR<TrendsResponse>(
    `/api/dashboard/trends?months=${months}`,
    fetcher
  )

  return { trends: data, isLoading, error }
}

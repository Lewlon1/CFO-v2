import useSWR from 'swr'
import { fetcher } from './fetcher'
import type { BalanceSheetResponse } from '@/app/api/balance-sheet/route'

export function useBalanceSheet() {
  const { data, error, isLoading, mutate } = useSWR<BalanceSheetResponse>(
    '/api/balance-sheet',
    fetcher
  )

  return { balanceSheet: data, isLoading, error, mutate }
}

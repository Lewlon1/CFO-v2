// Stub — transaction categorisation will be implemented in Session 3
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MerchantMapping = Record<string, any>

export function categoriseTransaction(
  _description: string,
  _mappings: MerchantMapping[]
): string {
  return 'Uncategorised'
}

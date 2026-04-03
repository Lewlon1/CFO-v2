export type MerchantMapping = {
  merchant_pattern: string
  category_name: string
  source: 'system' | 'user' | 'ai'
  profile_id: string | null
}

/**
 * Categorises a transaction by matching its normalised merchant/description text
 * against known merchant patterns from the DB. Used by the Value Map demo flow.
 * User-specific mappings take priority over system defaults; longest pattern wins.
 */
export function categoriseTransaction(
  merchantText: string,
  mappings: MerchantMapping[]
): string {
  if (!merchantText) return 'Uncategorised'
  const lower = merchantText.toLowerCase()

  const userMappings = mappings.filter((m) => m.profile_id !== null)
  const systemMappings = mappings.filter((m) => m.profile_id === null)

  const userMatch = findLongestMatch(lower, userMappings)
  if (userMatch) return userMatch.category_name

  const systemMatch = findLongestMatch(lower, systemMappings)
  if (systemMatch) return systemMatch.category_name

  return 'Uncategorised'
}

function findLongestMatch(text: string, mappings: MerchantMapping[]): MerchantMapping | null {
  return (
    mappings
      .filter((m) => text.includes(m.merchant_pattern))
      .sort((a, b) => b.merchant_pattern.length - a.merchant_pattern.length)[0] ?? null
  )
}

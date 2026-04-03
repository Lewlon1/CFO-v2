import { createClient } from "@/lib/supabase/client"
import type { MerchantMapping } from "./categorise-transaction"

let cachedMappings: MerchantMapping[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Loads all merchant-to-category mappings (system defaults + user overrides)
 * from Supabase. Results are cached for 5 minutes to avoid repeated queries.
 */
export async function loadMappings(
  forceRefresh = false
): Promise<MerchantMapping[]> {
  const now = Date.now()
  if (!forceRefresh && cachedMappings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedMappings
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from("merchant_category_map")
    .select("merchant_pattern, category_name, source, profile_id")

  if (error) {
    console.error("Failed to load merchant mappings:", error.message)
    return cachedMappings ?? []
  }

  cachedMappings = (data ?? []) as MerchantMapping[]
  cacheTimestamp = now
  return cachedMappings
}

/**
 * Invalidate the cached mappings (call after user creates/updates a mapping).
 */
export function invalidateMappingsCache() {
  cachedMappings = null
  cacheTimestamp = 0
}

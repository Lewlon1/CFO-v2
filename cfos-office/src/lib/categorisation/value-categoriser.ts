import type { Category, ValueCategoryRule } from '@/lib/parsers/types'
import { normaliseMerchant } from './normalise-merchant'

export type ValueCatResult = {
  valueCategory: string
  confidence: number
  source: 'user_description_rule' | 'user_category_rule' | 'category_default' | 'none'
}

/**
 * Assign a value category using layered priority:
 * 1. User description rules (merchant_contains match)
 * 2. User category rules (category_id match)
 * 3. Category default_value_category
 * 4. Fallback → 'unsure'
 */
export function assignValueCategory(
  description: string,
  categoryId: string | null,
  userRules: ValueCategoryRule[],
  categories: Category[]
): ValueCatResult {
  const normalised = normaliseMerchant(description)

  // Priority 1: user description rules
  for (const rule of userRules) {
    if (rule.match_type === 'merchant_contains') {
      if (normalised.includes(rule.match_value.toLowerCase())) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_description_rule',
        }
      }
    }
  }

  // Priority 2: user category rules
  if (categoryId) {
    for (const rule of userRules) {
      if (rule.match_type === 'category_id' && rule.match_value === categoryId) {
        return {
          valueCategory: rule.value_category,
          confidence: rule.confidence,
          source: 'user_category_rule',
        }
      }
    }
  }

  // Priority 3: category default
  if (categoryId) {
    const cat = categories.find((c) => c.id === categoryId)
    if (cat?.default_value_category) {
      return {
        valueCategory: cat.default_value_category,
        confidence: 0.3,
        source: 'category_default',
      }
    }
  }

  return { valueCategory: 'unsure', confidence: 0, source: 'none' }
}

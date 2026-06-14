export type SemanticField =
  | 'date' | 'amount' | 'description' | 'merchant'
  | 'type' | 'category' | 'currency' | 'skip'

export const SEMANTIC_FIELD_LABELS: Record<SemanticField, string> = {
  date: 'Date', amount: 'Amount', description: 'Description',
  merchant: 'Merchant', type: 'Type (income/expense)',
  category: 'Category', currency: 'Currency', skip: 'Skip this column',
}

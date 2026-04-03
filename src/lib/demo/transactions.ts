export interface DemoTransaction {
  id: string
  merchant: string
  amount: number
  currency: string
  context: string
  traditional_category: string
}

export interface DemoCountry {
  code: string
  name: string
  flag: string
  currency: string
}

export const DEMO_COUNTRIES: DemoCountry[] = [
  { code: 'UK', name: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}', currency: 'GBP' },
  { code: 'ES', name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}', currency: 'EUR' },
  { code: 'US', name: 'United States', flag: '\u{1F1FA}\u{1F1F8}', currency: 'USD' },
  { code: 'DE', name: 'Germany', flag: '\u{1F1E9}\u{1F1EA}', currency: 'EUR' },
]

const UK_TRANSACTIONS: DemoTransaction[] = [
  { id: 'uk-1', merchant: 'Deliveroo', amount: 28.50, currency: 'GBP', context: 'Friday 11pm, after a long work week. You were exhausted.', traditional_category: 'Dining' },
  { id: 'uk-2', merchant: 'PureGym', amount: 24.99, currency: 'GBP', context: 'Monthly membership. You went 3 times this month.', traditional_category: 'Health & Fitness' },
  { id: 'uk-3', merchant: 'Netflix', amount: 15.99, currency: 'GBP', context: 'Standard plan, shared with your partner.', traditional_category: 'Subscriptions' },
  { id: 'uk-4', merchant: 'Tesco', amount: 87.30, currency: 'GBP', context: 'Weekly shop \u2014 food, cleaning products, wine, and snacks.', traditional_category: 'Groceries' },
  { id: 'uk-5', merchant: 'Uber', amount: 14.00, currency: 'GBP', context: "Late night ride home from a friend's birthday dinner.", traditional_category: 'Transport' },
  { id: 'uk-6', merchant: 'Amazon', amount: 34.99, currency: 'GBP', context: 'A book on leadership and a replacement phone case.', traditional_category: 'Shopping' },
  { id: 'uk-7', merchant: 'Costa Coffee', amount: 4.20, currency: 'GBP', context: 'Tuesday morning, 20 minutes before a big work meeting.', traditional_category: 'Dining' },
  { id: 'uk-8', merchant: 'Council Tax', amount: 156.00, currency: 'GBP', context: 'Monthly direct debit. Non-negotiable.', traditional_category: 'Taxes & Government' },
  { id: 'uk-9', merchant: 'Headspace', amount: 9.99, currency: 'GBP', context: "Annual subscription. You've used it twice since subscribing.", traditional_category: 'Health & Fitness' },
  { id: 'uk-10', merchant: 'Zara', amount: 65.00, currency: 'GBP', context: 'New shirt. You have a job interview next week.', traditional_category: 'Shopping' },
]

const ES_TRANSACTIONS: DemoTransaction[] = [
  { id: 'es-1', merchant: 'Glovo', amount: 24.50, currency: 'EUR', context: 'Friday 11pm, after a long work week. You were exhausted.', traditional_category: 'Dining' },
  { id: 'es-2', merchant: 'McFit', amount: 29.90, currency: 'EUR', context: 'Monthly membership. You went 3 times this month.', traditional_category: 'Health & Fitness' },
  { id: 'es-3', merchant: 'Netflix', amount: 12.99, currency: 'EUR', context: 'Standard plan, shared with your partner.', traditional_category: 'Subscriptions' },
  { id: 'es-4', merchant: 'Mercadona', amount: 78.40, currency: 'EUR', context: 'Weekly shop \u2014 food, cleaning products, wine, and snacks.', traditional_category: 'Groceries' },
  { id: 'es-5', merchant: 'Cabify', amount: 11.00, currency: 'EUR', context: "Late night ride home from a friend's birthday dinner.", traditional_category: 'Transport' },
  { id: 'es-6', merchant: 'Amazon', amount: 29.99, currency: 'EUR', context: 'A book on personal development and a replacement phone case.', traditional_category: 'Shopping' },
  { id: 'es-7', merchant: 'Caf\u00e9 con leche', amount: 2.80, currency: 'EUR', context: 'Tuesday morning, 20 minutes before a big work meeting.', traditional_category: 'Dining' },
  { id: 'es-8', merchant: 'IRPF trimestral', amount: 350.00, currency: 'EUR', context: 'Quarterly self-employment tax payment. Non-negotiable.', traditional_category: 'Taxes & Government' },
  { id: 'es-9', merchant: 'Calm', amount: 9.99, currency: 'EUR', context: "Annual subscription. You've used it twice since subscribing.", traditional_category: 'Health & Fitness' },
  { id: 'es-10', merchant: 'Zara', amount: 49.99, currency: 'EUR', context: 'New shirt. You have a job interview next week.', traditional_category: 'Shopping' },
]

const US_TRANSACTIONS: DemoTransaction[] = [
  { id: 'us-1', merchant: 'DoorDash', amount: 32.00, currency: 'USD', context: 'Friday 11pm, after a long work week. You were exhausted.', traditional_category: 'Dining' },
  { id: 'us-2', merchant: 'Planet Fitness', amount: 24.99, currency: 'USD', context: 'Monthly membership. You went 3 times this month.', traditional_category: 'Health & Fitness' },
  { id: 'us-3', merchant: 'Netflix', amount: 15.49, currency: 'USD', context: 'Standard plan, shared with your partner.', traditional_category: 'Subscriptions' },
  { id: 'us-4', merchant: 'Walmart', amount: 94.50, currency: 'USD', context: 'Weekly groceries \u2014 food, cleaning supplies, beer, and chips.', traditional_category: 'Groceries' },
  { id: 'us-5', merchant: 'Uber', amount: 18.00, currency: 'USD', context: "Late night ride home from a friend's birthday dinner.", traditional_category: 'Transport' },
  { id: 'us-6', merchant: 'Amazon', amount: 38.99, currency: 'USD', context: 'A book on leadership and a replacement phone case.', traditional_category: 'Shopping' },
  { id: 'us-7', merchant: 'Starbucks', amount: 6.50, currency: 'USD', context: 'Tuesday morning, 20 minutes before a big work meeting.', traditional_category: 'Dining' },
  { id: 'us-8', merchant: 'Federal tax', amount: 420.00, currency: 'USD', context: 'Quarterly estimated tax payment. Non-negotiable.', traditional_category: 'Taxes & Government' },
  { id: 'us-9', merchant: 'Headspace', amount: 12.99, currency: 'USD', context: "Annual subscription. You've used it twice since subscribing.", traditional_category: 'Health & Fitness' },
  { id: 'us-10', merchant: 'H&M', amount: 55.00, currency: 'USD', context: 'New shirt. You have a job interview next week.', traditional_category: 'Shopping' },
]

const DE_TRANSACTIONS: DemoTransaction[] = [
  { id: 'de-1', merchant: 'Lieferando', amount: 26.50, currency: 'EUR', context: 'Friday 11pm, after a long work week. You were exhausted.', traditional_category: 'Dining' },
  { id: 'de-2', merchant: 'FitX', amount: 19.99, currency: 'EUR', context: 'Monthly membership. You went 3 times this month.', traditional_category: 'Health & Fitness' },
  { id: 'de-3', merchant: 'Netflix', amount: 12.99, currency: 'EUR', context: 'Standard plan, shared with your partner.', traditional_category: 'Subscriptions' },
  { id: 'de-4', merchant: 'REWE', amount: 82.30, currency: 'EUR', context: 'Weekly shop \u2014 food, cleaning products, wine, and snacks.', traditional_category: 'Groceries' },
  { id: 'de-5', merchant: 'FREE NOW', amount: 12.00, currency: 'EUR', context: "Late night ride home from a friend's birthday dinner.", traditional_category: 'Transport' },
  { id: 'de-6', merchant: 'Amazon', amount: 32.99, currency: 'EUR', context: 'A book on leadership and a replacement phone case.', traditional_category: 'Shopping' },
  { id: 'de-7', merchant: 'Kaffee to go', amount: 3.80, currency: 'EUR', context: 'Tuesday morning, 20 minutes before a big work meeting.', traditional_category: 'Dining' },
  { id: 'de-8', merchant: 'Einkommensteuer', amount: 450.00, currency: 'EUR', context: 'Quarterly income tax prepayment. Non-negotiable.', traditional_category: 'Taxes & Government' },
  { id: 'de-9', merchant: 'Calm', amount: 9.99, currency: 'EUR', context: "Annual subscription. You've used it twice since subscribing.", traditional_category: 'Health & Fitness' },
  { id: 'de-10', merchant: 'H&M', amount: 45.00, currency: 'EUR', context: 'New shirt. You have a job interview next week.', traditional_category: 'Shopping' },
]

const TRANSACTION_MAP: Record<string, DemoTransaction[]> = {
  UK: UK_TRANSACTIONS,
  ES: ES_TRANSACTIONS,
  US: US_TRANSACTIONS,
  DE: DE_TRANSACTIONS,
}

export function getDemoTransactions(countryCode: string): DemoTransaction[] {
  return TRANSACTION_MAP[countryCode] ?? UK_TRANSACTIONS
}

// Locked observation templates for the four-beat wow moment. Beats 02, 03,
// and 04 are rendered from these strings via `substitute()` — Claude is only
// allowed to narrate around them in beat 01, never to invent the beats
// themselves. Every template is a *noticing* experiment: observe / track /
// jot down. No "cancel," "switch," or "consider."

export interface ObservationTemplate {
  pattern_name_options: string[]
  question_template: string
  experiment_template: string
  noticing_target_key: string
}

export const TEMPLATES: Record<string, ObservationTemplate> = {
  'high_freq_merchant.rhythm': {
    pattern_name_options: [
      'The {merchant_name} Rhythm',
      'Your {merchant_name} Loop',
      'The Daily {merchant_name}',
    ],
    question_template:
      'What is {merchant_name} actually doing for you on the days you walk in?',
    experiment_template:
      'For the next 7 days, before you walk into {merchant_name}, pause and name the cue — boredom, hunger, habit, treat. No need to change anything. Just notice. We will look at it together next week.',
    noticing_target_key: 'merchant_name',
  },
  'category_variance.discipline_eats_joy': {
    pattern_name_options: [
      'When Discipline Eats the Joy',
      'The Quiet Squeeze',
      'Foundation-Heavy, Joy-Light',
    ],
    question_template:
      'When essentials and obligations take {locked_share}% of every {currency_symbol} you spend, what is getting pushed out?',
    experiment_template:
      'For one week, every time you almost spend on something for yourself and stop, jot down what you were about to buy and why you did not. No judgement, no rule. Just collect the list. We will read it together.',
    noticing_target_key: 'locked_category_label',
  },
  'time_pattern.weekend_clock': {
    pattern_name_options: [
      'The Weekend Clock',
      'Two Different People',
      'When Saturday Hits',
    ],
    question_template:
      'You spend roughly {ratio}× more on weekends than weekdays. What changes about you between Friday night and Sunday evening?',
    experiment_template:
      'For one weekend, every time you spend on something you would not buy on a weekday, note it. One line each. We will look at the list together to see what is actually doing the work — relief, social, momentum.',
    noticing_target_key: 'weekend_label',
  },
}

export function substitute(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    if (!(key in payload)) {
      throw new Error(`Unfilled template placeholder: {${key}}`)
    }
    const value = payload[key]
    if (value === null || value === undefined) {
      throw new Error(`Null/undefined value for template placeholder: {${key}}`)
    }
    return String(value)
  })
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'EUR':
      return '€'
    case 'GBP':
      return '£'
    case 'USD':
      return '$'
    default:
      return `${currency} `
  }
}

// "amazon" → "Amazon", "uber eats" → "Uber Eats". Keeps multi-word merchants
// from rendering as lowercase in the locked beat strings.
export function toTitleCase(input: string): string {
  if (!input) return ''
  return input
    .split(/\s+/)
    .map((word) => (word.length === 0 ? '' : word[0].toUpperCase() + word.slice(1)))
    .join(' ')
}

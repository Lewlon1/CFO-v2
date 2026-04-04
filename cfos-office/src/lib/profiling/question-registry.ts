// ── Types ──────────────────────────────────────────────────────────────────────

export type InputType =
  | 'single_select'
  | 'multi_select'
  | 'currency_amount'
  | 'number'
  | 'text'
  | 'slider';

export type SelectOption = {
  value: string;
  label: string;
};

export type StructuredInputConfig = {
  input_type: InputType;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  currency?: boolean;
  placeholder?: string;
  low_label?: string;
  high_label?: string;
};

export type ProfileQuestionCondition = {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'exists';
  value?: string | string[];
};

export type ProfileQuestion = {
  field: string;
  phase: 1 | 2 | 3 | 4;
  weight: 1 | 2 | 3;
  label: string;
  rationale: string;
  input_config: StructuredInputConfig;
  dependencies?: string[];
  condition?: ProfileQuestionCondition;
  min_conversations?: number;
  context_keywords?: string[];
};

// ── Question Registry ─────────────────────────────────────────────────────────

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  // ── Phase 1: Immediate (signup + first CSV) ──────────────────────────────

  {
    field: 'primary_currency',
    phase: 1,
    weight: 3,
    label: 'What currency do you use day-to-day?',
    rationale: 'So I show amounts in the right currency',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'EUR', label: 'EUR (€)' },
        { value: 'GBP', label: 'GBP (£)' },
        { value: 'USD', label: 'USD ($)' },
        { value: 'CHF', label: 'CHF (Fr.)' },
      ],
    },
  },
  {
    field: 'country',
    phase: 1,
    weight: 3,
    label: 'Which country do you live in?',
    rationale: 'Tax rules and financial products vary by country',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'ES', label: 'Spain' },
        { value: 'GB', label: 'United Kingdom' },
        { value: 'US', label: 'United States' },
        { value: 'DE', label: 'Germany' },
        { value: 'FR', label: 'France' },
        { value: 'IE', label: 'Ireland' },
        { value: 'NL', label: 'Netherlands' },
        { value: 'PT', label: 'Portugal' },
        { value: 'IT', label: 'Italy' },
      ],
    },
  },
  {
    field: 'net_monthly_income',
    phase: 1,
    weight: 3,
    label: 'What is your monthly take-home pay?',
    rationale: 'I need to know what comes in to understand what goes out',
    input_config: {
      input_type: 'currency_amount',
      currency: true,
      min: 0,
      placeholder: '2,500',
    },
  },
  {
    field: 'housing_type',
    phase: 1,
    weight: 3,
    label: 'What is your housing situation?',
    rationale: 'Housing is usually your biggest expense — this shapes your fixed cost baseline',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'Renting', label: 'Renting' },
        { value: 'Mortgage', label: 'Own with mortgage' },
        { value: 'Own outright', label: 'Own outright' },
        { value: 'Living with family', label: 'Living with family' },
      ],
    },
  },

  // ── Phase 2: After initial analysis ──────────────────────────────────────

  {
    field: 'age_range',
    phase: 2,
    weight: 2,
    label: 'What age range are you in?',
    rationale: 'Your age shapes the investment timeline and retirement planning',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: '18-25', label: '18–25' },
        { value: '26-30', label: '26–30' },
        { value: '31-35', label: '31–35' },
        { value: '36-40', label: '36–40' },
        { value: '41-50', label: '41–50' },
        { value: '50+', label: '50+' },
      ],
    },
    min_conversations: 1,
    context_keywords: ['retirement', 'pension', 'future', 'goal', 'invest'],
  },
  {
    field: 'employment_status',
    phase: 2,
    weight: 2,
    label: 'What is your employment situation?',
    rationale: 'Employment type affects tax, pension, and income stability',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'Employed full-time', label: 'Employed full-time' },
        { value: 'Employed part-time', label: 'Employed part-time' },
        { value: 'Self-employed', label: 'Self-employed' },
        { value: 'Freelance', label: 'Freelance' },
        { value: 'Unemployed', label: 'Unemployed' },
        { value: 'Student', label: 'Student' },
        { value: 'Retired', label: 'Retired' },
      ],
    },
    dependencies: ['net_monthly_income'],
    min_conversations: 1,
  },
  {
    field: 'monthly_rent',
    phase: 2,
    weight: 2,
    label: 'How much is your monthly rent or mortgage payment?',
    rationale: 'Rent or mortgage determines your fixed cost baseline',
    input_config: {
      input_type: 'currency_amount',
      currency: true,
      min: 0,
      placeholder: '1,200',
    },
    dependencies: ['housing_type'],
    condition: {
      field: 'housing_type',
      operator: 'in',
      value: ['Renting', 'Mortgage'],
    },
    min_conversations: 1,
  },
  {
    field: 'relationship_status',
    phase: 2,
    weight: 2,
    label: 'What is your relationship status?',
    rationale: 'Shared finances change the picture significantly',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'Single', label: 'Single' },
        { value: 'In a relationship', label: 'In a relationship' },
        { value: 'Married', label: 'Married' },
        { value: 'Divorced', label: 'Divorced' },
      ],
    },
    min_conversations: 1,
    context_keywords: ['partner', 'girlfriend', 'boyfriend', 'wife', 'husband', 'single'],
  },

  // ── Phase 3: Ongoing (contextually relevant) ────────────────────────────

  {
    field: 'risk_tolerance',
    phase: 3,
    weight: 1,
    label: 'How comfortable are you with financial risk?',
    rationale: 'Your comfort with risk determines the right approach to investing and saving',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'Very cautious', label: 'Very cautious' },
        { value: 'Conservative', label: 'Conservative' },
        { value: 'Moderate', label: 'Moderate' },
        { value: 'Growth-oriented', label: 'Growth-oriented' },
        { value: 'High risk OK', label: 'High risk OK' },
      ],
    },
    min_conversations: 2,
    context_keywords: ['invest', 'stocks', 'savings', 'risk', 'crypto', 'portfolio'],
  },
  {
    field: 'dependents',
    phase: 3,
    weight: 1,
    label: 'Do you have any dependents?',
    rationale: 'Children or dependents significantly change the financial picture',
    input_config: {
      input_type: 'number',
      min: 0,
      max: 10,
      placeholder: '0',
    },
    min_conversations: 2,
    context_keywords: ['kids', 'children', 'baby', 'family', 'school', 'childcare'],
  },
  {
    field: 'advice_style',
    phase: 3,
    weight: 1,
    label: 'How do you want me to communicate with you?',
    rationale: 'Some want encouragement, others want hard truth — I want to get this right',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'gentle', label: 'Gentle nudges' },
        { value: 'direct', label: 'Direct and honest' },
        { value: 'blunt', label: "Blunt — don't sugarcoat it" },
      ],
    },
    min_conversations: 2,
  },
  {
    field: 'spending_triggers',
    phase: 3,
    weight: 1,
    label: 'What tends to trigger unplanned spending for you?',
    rationale: 'Understanding triggers helps design guardrails that actually work',
    input_config: {
      input_type: 'multi_select',
      options: [
        { value: 'stress', label: 'Stress or bad mood' },
        { value: 'social', label: 'Social pressure' },
        { value: 'boredom', label: 'Boredom' },
        { value: 'sales', label: 'Sales or deals' },
        { value: 'payday', label: 'Just got paid' },
        { value: 'alcohol', label: 'After drinking' },
        { value: 'none', label: "Nothing specific" },
      ],
    },
    min_conversations: 3,
    context_keywords: ['spend', 'impulse', 'budget', 'overspend', 'splurge'],
  },

  // ── Phase 4: Deep profile (engaged users) ───────────────────────────────

  {
    field: 'nationality',
    phase: 4,
    weight: 1,
    label: 'What is your nationality?',
    rationale: 'Cross-border finances need special handling for tax and banking',
    input_config: {
      input_type: 'text',
      placeholder: 'e.g. British, Spanish',
    },
    min_conversations: 4,
    context_keywords: ['passport', 'visa', 'home country', 'moved', 'expat'],
  },
  {
    field: 'partner_monthly_contribution',
    phase: 4,
    weight: 1,
    label: 'How much does your partner contribute monthly to shared costs?',
    rationale: 'Knowing shared costs helps calculate your true personal spending',
    input_config: {
      input_type: 'currency_amount',
      currency: true,
      min: 0,
      placeholder: '1,000',
    },
    dependencies: ['relationship_status'],
    condition: {
      field: 'relationship_status',
      operator: 'in',
      value: ['In a relationship', 'Married'],
    },
    min_conversations: 4,
  },
  {
    field: 'has_bonus_months',
    phase: 4,
    weight: 1,
    label: 'Do you receive bonus months or extra pay?',
    rationale: 'Irregular income changes how we plan — Spain has 14 paychecks, for example',
    input_config: {
      input_type: 'single_select',
      options: [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ],
    },
    dependencies: ['employment_status'],
    condition: {
      field: 'employment_status',
      operator: 'in',
      value: ['Employed full-time', 'Employed part-time'],
    },
    min_conversations: 4,
    context_keywords: ['salary', 'pay', 'bonus', 'extra pay', '14 payments'],
  },
];

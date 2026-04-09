// Prompt button configuration for the chat welcome screen.
//
// Two sets: one for users who haven't uploaded transactions yet
// (focus: exploration, encouragement, broad topics) and one for
// users with data (focus: data-driven actions, reviews, optimisation).
//
// `id` is stable for analytics even if `label` copy changes.
// `label` is what users see on the button (short, one-line on mobile).
// `message` is what actually gets sent to the CFO (longer, gives Claude context).

export type PromptConversationType =
  | 'trip_planning'
  | 'scenario'
  | 'monthly_review';

export interface PromptButton {
  /** Stable identifier for analytics — never changes even if label copy is tweaked */
  id: string;
  /** Text displayed on the button */
  label: string;
  /** The actual message sent to the CFO when tapped (can differ from label) */
  message: string;
  /** Conversation type routed to context-builder. Undefined = generic conversation. */
  conversationType?: PromptConversationType;
  /** Display order (lower = higher on screen) */
  order: number;
}

/**
 * Prompts for users who have NOT yet uploaded transaction data.
 * Focus: exploration, upload encouragement, broad financial topics.
 */
export const NEW_USER_PROMPTS: PromptButton[] = [
  {
    id: 'new_build_budget',
    label: 'Build me a budget',
    message:
      "I want to build a budget. Can you help me work out what I should be spending across different areas?",
    order: 1,
  },
  {
    id: 'new_wasting_money',
    label: 'What am I wasting money on?',
    message: "I want to find out what I'm wasting money on. Where do I start?",
    order: 2,
  },
  {
    id: 'new_plan_trip',
    label: 'Help me plan a trip',
    message:
      'I want to plan a trip. Can you help me figure out the budget and how to fund it?',
    conversationType: 'trip_planning',
    order: 3,
  },
  {
    id: 'new_financial_goal',
    label: 'Set a financial goal',
    message:
      "I want to set a financial goal. Can you help me figure out what's realistic and how to get there?",
    order: 4,
  },
  {
    id: 'new_what_if',
    label: 'What if I...',
    message:
      'I want to model a scenario — a salary change, a big purchase, or a life change. Can you help me see the impact?',
    conversationType: 'scenario',
    order: 5,
  },
  {
    id: 'new_tax_breaks',
    label: 'Am I missing any tax breaks?',
    message:
      "Are there any tax breaks or government initiatives I might be eligible for? I want to make sure I'm not leaving money on the table.",
    order: 6,
  },
];

/**
 * Prompts for users who HAVE uploaded transaction data.
 * Focus: data-driven actions, reviews, optimisation.
 */
export const RETURNING_USER_PROMPTS: PromptButton[] = [
  {
    id: 'returning_wasting_money',
    label: 'What am I wasting money on?',
    message:
      'Look at my spending data — what am I wasting money on? Be specific.',
    order: 1,
  },
  {
    id: 'returning_monthly_review',
    label: 'How did I do this month?',
    message:
      "Let's do a monthly review. How did my spending look this month compared to last?",
    conversationType: 'monthly_review',
    order: 2,
  },
  {
    id: 'returning_build_budget',
    label: 'Build me a budget',
    message:
      'Based on my income and spending patterns, build me a realistic budget.',
    order: 3,
  },
  {
    id: 'returning_recurring',
    label: 'Review my recurring payments',
    message:
      'Review my recurring payments and subscriptions. Am I overpaying for anything? What could I cut or switch?',
    order: 4,
  },
  {
    id: 'returning_plan_trip',
    label: 'Help me plan a trip',
    message:
      'I want to plan a trip. Can you help me figure out the budget and how to fund it from my current cash flow?',
    conversationType: 'trip_planning',
    order: 5,
  },
  {
    id: 'returning_life_change',
    label: "I've got a big life change coming",
    message:
      'I have a major life change coming up and I want to understand the financial impact. Can we talk through it?',
    conversationType: 'scenario',
    order: 6,
  },
];

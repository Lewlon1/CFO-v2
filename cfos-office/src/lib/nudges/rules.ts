export type NudgeType =
  | 'payday_savings'
  | 'budget_alert'
  | 'bill_due'
  | 'contract_expiry'
  | 'monthly_review'
  | 'action_item_reminder'
  | 'upload_reminder'
  | 'spending_spike'
  | 'goal_milestone';

export type NudgeFrequency = 'once' | 'recurring';
export type NudgePriority = 'high' | 'medium' | 'low';

export interface NudgeRule {
  type: NudgeType;
  title_template: string;
  body_template: string;
  action_url: string;
  priority: NudgePriority;
  frequency: NudgeFrequency;
  cooldown_hours: number;
  max_per_month: number;
  enabled_by_default: boolean;
  evaluation_schedule: 'daily' | 'weekly' | 'monthly' | 'on_transaction';
}

export const NUDGE_RULES: Record<NudgeType, NudgeRule> = {
  payday_savings: {
    type: 'payday_savings',
    title_template: 'Payday detected — time to pay yourself first',
    body_template:
      'Your salary of {{amount}} {{currency}} just landed. Want to transfer {{savings_suggestion}} to savings before it disappears?',
    action_url: '/chat?nudge=payday_savings',
    priority: 'high',
    frequency: 'recurring',
    cooldown_hours: 672, // 28 days
    max_per_month: 1,
    enabled_by_default: true,
    evaluation_schedule: 'on_transaction',
  },

  budget_alert: {
    type: 'budget_alert',
    title_template: '{{category}} spending is at {{percentage}}% of budget',
    body_template:
      "You've spent {{spent}} of your {{budget}} {{currency}} {{category}} budget this month, with {{days_remaining}} days to go.",
    action_url: '/chat?nudge=budget_alert&category={{category_slug}}',
    priority: 'medium',
    frequency: 'recurring',
    cooldown_hours: 168, // 7 days
    max_per_month: 4,
    enabled_by_default: true,
    evaluation_schedule: 'daily',
  },

  bill_due: {
    type: 'bill_due',
    title_template: '{{bill_name}} due in {{days}} days',
    body_template:
      '{{bill_name}} ({{amount}} {{currency}}) is due on {{due_date}}. Make sure you have funds available.',
    action_url: '/office/cash-flow/bills',
    priority: 'medium',
    frequency: 'recurring',
    cooldown_hours: 168, // 7 days
    max_per_month: 8,
    enabled_by_default: true,
    evaluation_schedule: 'daily',
  },

  contract_expiry: {
    type: 'contract_expiry',
    title_template: '{{provider}} contract expires in {{days}} days',
    body_template:
      'Your {{provider}} contract ends on {{expiry_date}}. Want me to research alternatives before you auto-renew?',
    action_url: '/chat?nudge=contract_expiry&provider={{provider_slug}}',
    priority: 'high',
    frequency: 'once',
    cooldown_hours: 720, // 30 days
    max_per_month: 2,
    enabled_by_default: true,
    evaluation_schedule: 'daily',
  },

  monthly_review: {
    type: 'monthly_review',
    title_template: 'Your {{month}} spending review is ready',
    body_template:
      "I've crunched last month's numbers. Ready to see how {{month}} went?",
    action_url: '/chat?type=monthly_review',
    priority: 'high',
    frequency: 'recurring',
    cooldown_hours: 720, // 30 days
    max_per_month: 1,
    enabled_by_default: true,
    evaluation_schedule: 'monthly',
  },

  action_item_reminder: {
    type: 'action_item_reminder',
    title_template: 'Reminder: {{action_title}}',
    body_template:
      'You\'ve had "{{action_title}}" on your list for {{days_pending}} days. Want to tackle it or reschedule?',
    action_url: '/chat?nudge=action_reminder&action_id={{action_id}}',
    priority: 'low',
    frequency: 'recurring',
    cooldown_hours: 168, // 7 days
    max_per_month: 4,
    enabled_by_default: true,
    evaluation_schedule: 'weekly',
  },

  upload_reminder: {
    type: 'upload_reminder',
    title_template: 'Time to upload your {{month}} statement',
    body_template:
      "It's been {{days}} days since your last upload. Upload your latest statement so I can keep your picture current.",
    action_url: '/chat?nudge=upload_reminder',
    priority: 'low',
    frequency: 'recurring',
    cooldown_hours: 720, // 30 days
    max_per_month: 1,
    enabled_by_default: true,
    evaluation_schedule: 'monthly',
  },

  spending_spike: {
    type: 'spending_spike',
    title_template: 'Unusual {{category}} spending detected',
    body_template:
      'Your {{category}} spending this week ({{amount}} {{currency}}) is {{multiplier}}x your weekly average. Want to take a look?',
    action_url: '/chat?nudge=spending_spike&category={{category_slug}}',
    priority: 'medium',
    frequency: 'recurring',
    cooldown_hours: 168, // 7 days
    max_per_month: 4,
    enabled_by_default: true,
    evaluation_schedule: 'daily',
  },

  goal_milestone: {
    type: 'goal_milestone',
    title_template:
      "You've hit {{percentage}}% of your {{goal_name}} goal!",
    body_template:
      "You've saved {{current}} of {{target}} {{currency}} for {{goal_name}}. Keep it up — you're on track to hit it by {{target_date}}.",
    action_url: '/office',
    priority: 'low',
    frequency: 'once',
    cooldown_hours: 720, // 30 days
    max_per_month: 2,
    enabled_by_default: true,
    evaluation_schedule: 'weekly',
  },
};

export const NUDGE_ICONS: Record<NudgeType, string> = {
  payday_savings: '💰',
  budget_alert: '⚠️',
  bill_due: '📄',
  contract_expiry: '📋',
  monthly_review: '📊',
  action_item_reminder: '☑️',
  upload_reminder: '📤',
  spending_spike: '📈',
  goal_milestone: '🎯',
};

export const NUDGE_LABELS: Record<NudgeType, string> = {
  payday_savings: 'Payday savings reminders',
  budget_alert: 'Budget alerts',
  bill_due: 'Bill due reminders',
  contract_expiry: 'Contract expiry alerts',
  monthly_review: 'Monthly review prompts',
  action_item_reminder: 'Action item reminders',
  upload_reminder: 'Upload reminders',
  spending_spike: 'Spending spike alerts',
  goal_milestone: 'Goal milestone celebrations',
};

export const PRIORITY_ORDER: Record<NudgePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

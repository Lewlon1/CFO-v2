import type { BeatMessage, OnboardingBeat } from './types'

// ── Beat message sequences ──────────────────────────────────────────────────
// All user-facing copy lives here. No strings hardcoded in components.
// {name} is replaced with user's first name from auth.
// Special tokens: CATEGORY_DISPLAY, ARCHETYPE_DISPLAY, INSIGHT_DISPLAY

export const BEAT_MESSAGES: Record<OnboardingBeat, BeatMessage[]> = {
  welcome: [
    {
      id: 'welcome-1',
      text: 'Welcome to the office, <strong class="text-[var(--accent-gold)]">{name}</strong>. I\'m your CFO.',
      delayMs: 1200,
    },
    {
      id: 'welcome-2',
      text: 'My job is straightforward — know your numbers better than you do and tell you what they mean. No jargon, no judgment. Just clarity.',
      delayMs: 1800,
    },
    {
      id: 'welcome-3',
      text: 'The more you share with me, the sharper my guidance gets. Think of this as our first meeting — I need to understand how you think about money before I can help you manage it.',
      delayMs: 2200,
    },
    {
      id: 'welcome-continue',
      delayMs: 400,
      action: 'continue',
      buttonText: "Let's go",
    },
  ],

  framework: [
    {
      id: 'framework-1',
      text: 'Most finance apps tell you <em>where</em> your money went. I want to understand <em>how you feel</em> about where it went. There\'s a difference.',
      delayMs: 1600,
    },
    {
      id: 'framework-2',
      text: 'CATEGORY_DISPLAY',
      delayMs: 2000,
    },
    {
      id: 'framework-3',
      text: 'Don\'t overlook <strong class="text-[rgba(232,168,76,0.5)]">Unsure</strong>. It\'s often the most insightful category — it reveals where your relationship with money is genuinely unresolved. Those are the areas where I can help most.',
      delayMs: 1800,
    },
    {
      id: 'framework-4',
      text: "I'd like to run a short exercise to set a baseline. I'll show you some common transactions — tell me how they feel. This isn't permanent — your categories will evolve as we get to know each other better.",
      delayMs: 2000,
    },
    {
      id: 'framework-continue',
      delayMs: 400,
      action: 'continue',
      buttonText: "Let's do it",
    },
  ],

  value_map: [
    {
      id: 'value-map-embed',
      delayMs: 0,
      action: 'embed_value_map',
    },
  ],

  archetype: [
    {
      id: 'archetype-intro',
      text: "That tells me a lot. Here's what I see:",
      delayMs: 1400,
    },
    {
      id: 'archetype-result',
      text: 'ARCHETYPE_DISPLAY',
      delayMs: 0,
    },
    {
      id: 'archetype-bridge',
      text: "That's your baseline. Now — want to see how your beliefs hold up against the real numbers? Upload a bank statement and I'll compare what you think with what your money actually says.",
      delayMs: 2000,
    },
    {
      id: 'archetype-continue',
      delayMs: 400,
      action: 'continue',
      buttonText: 'Upload a statement',
    },
  ],

  csv_upload: [
    {
      id: 'csv-prompt',
      text: "Share the last 3 months if you can — the more data I have, the more useful I'll be from day one.",
      delayMs: 1200,
    },
    {
      id: 'csv-embed',
      delayMs: 0,
      action: 'embed_upload',
    },
  ],

  capabilities: [
    {
      id: 'capabilities-ask',
      text: "While I analyse your statement — what brought you to the office? What should I focus on first?",
      delayMs: 1600,
    },
    {
      id: 'capabilities-embed',
      delayMs: 0,
      action: 'capability_picker',
    },
  ],

  first_insight: [
    {
      id: 'insight-intro',
      text: "Right — I've had a look through your statements. {tx_count} transactions. Here's what stands out:",
      delayMs: 1800,
    },
    {
      id: 'insight-content',
      text: 'INSIGHT_DISPLAY',
      delayMs: 0,
    },
    {
      id: 'insight-continue',
      delayMs: 400,
      action: 'continue',
      buttonText: 'Got it',
    },
  ],

  handoff: [
    {
      id: 'handoff-message',
      text: 'Your office is set up. Explore at your own pace, or ask me anything right here.',
      delayMs: 1400,
    },
    {
      id: 'handoff-cta',
      delayMs: 400,
      action: 'handoff',
      buttonText: 'Enter the Office',
    },
  ],
}

// ── Value categories (5 including Unsure) ────────────────────────────────────

export const ONBOARDING_VALUE_CATEGORIES = [
  { id: 'foundation', label: 'Foundation', color: '#22C55E', description: 'Essential to your daily life' },
  { id: 'investment', label: 'Investment', color: '#3B82F6', description: 'Builds future value' },
  { id: 'leak', label: 'Leak', color: '#F43F5E', description: "You'd cut it if you could" },
  { id: 'burden', label: 'Burden', color: '#8B5CF6', description: 'Necessary but resented' },
  { id: 'unsure', label: 'Unsure', color: 'rgba(232,168,76,0.5)', description: 'Genuinely conflicted' },
] as const

// ── Capability options (maps to office folders) ──────────────────────────────

export const CAPABILITY_OPTIONS = [
  { id: 'cashflow', label: 'Where my money actually goes', icon: '$', color: '#22C55E', folder: 'Cash Flow' },
  { id: 'values', label: 'Understanding my spending habits', icon: '◇', color: '#E8A84C', folder: 'Values & You' },
  { id: 'networth', label: 'Tracking what I own & owe', icon: '≡', color: '#06B6D4', folder: 'Net Worth' },
  { id: 'scenarios', label: 'Planning big financial decisions', icon: '⊕', color: '#F43F5E', folder: 'Scenario Planning' },
] as const

// ── CSV polling ──────────────────────────────────────────────────────────────

export const CSV_POLL_INTERVAL_MS = 3000
export const CSV_POLL_TIMEOUT_MS = 60000

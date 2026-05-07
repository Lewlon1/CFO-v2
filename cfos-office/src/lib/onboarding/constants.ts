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
      text: 'My job\u2019s simple — know your numbers better than you do, and tell you what they mean. No jargon. No lectures.',
      delayMs: 1800,
    },
    {
      id: 'welcome-3',
      text: 'Before we look at your numbers, I want to know how you think about money. The more you share, the sharper I get.',
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
      text: 'Most finance apps tell you <em>where</em> your money went. I\u2019d rather know <em>how you feel</em> about where it went. That\u2019s a different conversation.',
      delayMs: 1600,
    },
    {
      id: 'framework-2',
      text: 'CATEGORY_DISPLAY',
      delayMs: 2000,
    },
    {
      id: 'framework-3',
      text: 'Don\u2019t skip <strong class="text-[rgba(232,168,76,0.5)]">Unsure</strong>. That\u2019s the honest one — the category that flags where your relationship with money is still being figured out. That\u2019s where I can help most.',
      delayMs: 1800,
    },
    {
      id: 'framework-4',
      text: 'Quick exercise to set a baseline — no right or wrong answers, it\u2019s just so we can understand each other. I\u2019ll show you some common transactions; tell me how they feel. Nothing\u2019s locked in. The more we interact, the more these will evolve.',
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
      text: "That\u2019s the read. Now let\u2019s see where your spending matches it \u2014 and where it doesn\u2019t. That gap is where most of the wins live.",
      delayMs: 2000,
    },
    {
      id: 'archetype-continue',
      delayMs: 400,
      action: 'continue',
      buttonText: 'Show me the gap',
    },
  ],

  csv_upload: [
    {
      id: 'csv-prompt',
      text: "Three months if you can. The more I see, the sharper I get.",
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
      text: "While I look through your statements \u2014 what brought you in today? Where should I start?",
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
      id: 'insight-content',
      text: 'INSIGHT_DISPLAY',
      delayMs: 0,
    },
  ],

  handoff: [
    {
      id: 'handoff-welcome',
      text: 'Welcome to the office.',
      delayMs: 1400,
    },
    {
      id: 'handoff-body',
      text: 'WELCOME_DISPLAY',
      delayMs: 0,
    },
    {
      id: 'handoff-cta',
      delayMs: 600,
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
  { id: 'values', label: 'Why I spend the way I do', icon: '◇', color: '#E8A84C', folder: 'Values & You' },
  { id: 'networth', label: 'Tracking what I own & owe', icon: '≡', color: '#06B6D4', folder: 'Net Worth' },
  { id: 'scenarios', label: 'A big decision I need to make', icon: '⊕', color: '#F43F5E', folder: 'Scenario Planning' },
] as const

// ── CSV polling ──────────────────────────────────────────────────────────────

export const CSV_POLL_INTERVAL_MS = 3000
export const CSV_POLL_TIMEOUT_MS = 60000

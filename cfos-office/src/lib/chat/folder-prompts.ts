// Contextual chat openers per folder route.
//
// When the chat sheet opens on an empty conversation, it shows an
// email-style "Re: <folder>" subject plus four pre-prompts tailored
// to whichever folder the user is sitting on. The prompts fill the
// input on tap, letting the user edit before sending.

import { getTransformPosture, type PostureProfile } from '@/lib/analytics/posture-helpers'

export type FolderKey = 'home' | 'cash-flow' | 'values' | 'net-worth' | 'scenarios'

export interface FolderChatMeta {
  subject: string
  subtitle: string
  prompts: string[]
}

export const CHAT_SUBJECTS: Record<FolderKey, FolderChatMeta> = {
  home: {
    subject: "Let's talk big picture",
    subtitle: 'Anything across the whole office',
    prompts: [
      "What's the one thing I should do this month?",
      'Where is my money leaking?',
      'How am I trending vs last quarter?',
      "What don't I know about my own spending?",
    ],
  },
  'cash-flow': {
    subject: 'Re: Cash Flow',
    subtitle: 'About your spending this month',
    prompts: [
      'What drove my spending this month?',
      'Which subscriptions could I cancel today?',
      'Is this month normal for me?',
      "Where's the biggest leak right now?",
    ],
  },
  values: {
    subject: 'Re: Values & You',
    subtitle: 'About your archetype and the Gap',
    prompts: [
      'Walk me through my Gaps',
      'Has my archetype shifted?',
      'What am I unsure about most?',
      'Am I spending in line with what I said matters?',
    ],
  },
  'net-worth': {
    subject: 'Re: Net Worth',
    subtitle: 'About assets, liabilities, the big number',
    prompts: [
      'Why did my net worth move this month?',
      'Is my allocation sensible?',
      'What would paying off my biggest debt do?',
      'Am I on track for where I want to be at 40?',
    ],
  },
  scenarios: {
    subject: 'Re: Scenarios',
    subtitle: 'About goals, trips, what-ifs',
    prompts: [
      'Can I afford my next trip without derailing my savings?',
      'What would part-time at 40 actually require?',
      'Why is my emergency fund slipping?',
      'Model me taking a 15% pay cut',
    ],
  },
}

export function folderKeyFromPath(pathname: string | null): FolderKey {
  if (!pathname) return 'home'
  if (pathname.startsWith('/office/cash-flow')) return 'cash-flow'
  if (pathname.startsWith('/office/values')) return 'values'
  if (pathname.startsWith('/office/net-worth')) return 'net-worth'
  if (pathname.startsWith('/office/scenarios')) return 'scenarios'
  return 'home'
}

// STATUS: first pass — Lewis to refine.
// Cash Flow prompts shift on posture. See COPY-DECK.md.
const CASH_FLOW_SURVIVING_PROMPTS: string[] = [
  'Can I cover rent next month?',
  "When's my next invoice likely to land?",
  "What's the biggest leak right now?",
  'Walk me through the next 14 days',
]

const CASH_FLOW_PLANNING_PROMPTS: string[] = [
  "Where's my surplus going?",
  'What does the last 3 months look like net?',
  'Am I deploying capital well?',
  'What would a 3-month income gap look like?',
]

// Returns folder chat metadata for the given folder and profile.
// All folders return the static CHAT_SUBJECTS entry unchanged, except
// Cash Flow which swaps prompts when the user has a surviving or planning
// posture above the confidence gate. Stable, unknown, and below-threshold
// users see the default prompts.
export function getFolderChatMeta(
  folder: FolderKey,
  profile: PostureProfile | null | undefined,
): FolderChatMeta {
  const base = CHAT_SUBJECTS[folder]
  if (folder !== 'cash-flow') return base
  const transform = getTransformPosture(profile)
  if (transform === 'surviving') {
    return { ...base, prompts: CASH_FLOW_SURVIVING_PROMPTS }
  }
  if (transform === 'planning') {
    return { ...base, prompts: CASH_FLOW_PLANNING_PROMPTS }
  }
  return base
}

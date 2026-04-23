// ── Post-onboarding welcome copy & chip definitions ────────────────────────
// Revised 2026-04-22 per UX copy audit against the copy deck.

export interface WelcomeCopyInput {
  archetypeName: string
  archetypeSubtitle: string
  monthsPhrase: string | null
}

export interface WelcomeParagraphs {
  opening: string
  transition: string
  whatItIs: string
  shareMore: string
  useCases: string
  invitation: string
}

export function formatMonthsPhrase(months: number): string | null {
  if (months <= 0) return null
  if (months === 1) return 'a month'
  if (months === 2) return 'two months'
  if (months === 3) return 'three months'
  return `${months} months`
}

export function buildWelcomeCopy(input: WelcomeCopyInput): WelcomeParagraphs {
  const { archetypeName, archetypeSubtitle, monthsPhrase } = input

  const opening = monthsPhrase
    ? `You\u2019re **${archetypeName}** \u2014 ${archetypeSubtitle}. That\u2019s the lens I\u2019ll use from here. With ${monthsPhrase} of your spending in front of me, I already know what to protect and where to look.`
    : `You\u2019re **${archetypeName}** \u2014 ${archetypeSubtitle}. That\u2019s the lens I\u2019ll use from here. Every suggestion I make will pass through it.`

  const transition = monthsPhrase
    ? `The more of your life I can see, the sharper I get.`
    : `Right now I\u2019m working from what you told me, not what your bank shows. The more I can see, the sharper I get.`

  const whatItIs = `Here\u2019s what this place is. I\u2019m not a budgeting app. I won\u2019t ping you when you overspend on coffee, and I won\u2019t make you fill in spreadsheets. I\u2019m a CFO \u2014 I look at your real numbers, spot what you can\u2019t see from the inside, and help you make the calls that move you forward.`

  const shareMore = `Other accounts, credit cards, bills I haven\u2019t seen yet \u2014 that\u2019s where the gaps usually hide. Show me what you pay for electricity, internet, or your phone and I can often find you a better deal within minutes.`

  // Cut: the "reasons people come" paragraph duplicated content from the
  // capabilities beat and the chips below. Empty string renders nothing.
  const useCases = ``

  const invitation = `**What\u2019s on your mind today?**`

  return { opening, transition, whatItIs, shareMore, useCases, invitation }
}

// ── Action chips ───────────────────────────────────────────────────────────

export interface WelcomeChip {
  id: string
  label: string
  prompt: string
  primary?: boolean
}

export const WELCOME_CHIPS: WelcomeChip[] = [
  {
    id: 'spending',
    label: 'Show me where my money\u2019s going',
    prompt: 'Show me where my money\u2019s going.',
    primary: true,
  },
  {
    id: 'bills',
    label: 'Sort out my monthly bills',
    prompt: 'Help me sort out my monthly bills.',
  },
  {
    id: 'add-account',
    label: 'Add another account or card',
    prompt: 'I\u2019d like to add another account or card so you can see the full picture.',
  },
  {
    id: 'trip',
    label: 'Plan a trip I keep delaying',
    prompt: 'I want to plan a trip I\u2019ve been putting off. Help me figure out how to afford it.',
  },
]

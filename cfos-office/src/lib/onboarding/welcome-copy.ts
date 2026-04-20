// ── Post-onboarding welcome copy & chip definitions ────────────────────────
// Copy is final — do not reword without explicit approval.

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
    ? `Your Value Map said you\u2019re **${archetypeName}** \u2014 ${archetypeSubtitle}. That\u2019s not a label, it\u2019s the lens I\u2019ll use from here. With ${monthsPhrase} of your spending in front of me, I already know what to protect and where to look for money you can free up.`
    : `Your Value Map said you\u2019re **${archetypeName}** \u2014 ${archetypeSubtitle}. That\u2019s not a label, it\u2019s the lens I\u2019ll use from here. Every suggestion I make will pass through it.`

  const transition = monthsPhrase
    ? `That\u2019s the starting line, not the finish. The more of your life I can see, the sharper I get.`
    : `Right now I\u2019m working from what you told me, not what your bank shows. The more I can see, the sharper I get \u2014 and the sooner I can turn this into real money saved without compromise.`

  const whatItIs = `Here\u2019s what this place is, and what it isn\u2019t. I\u2019m not a budgeting app. I won\u2019t ping you when you overspend on coffee, and I won\u2019t make you fill in spreadsheets. I\u2019m a CFO. My job is to look at your real numbers, spot the patterns you can\u2019t see from the inside, and help you make decisions that actually move you forward.`

  const shareMore = `If you\u2019ve got accounts I haven\u2019t seen yet \u2014 a credit card, a savings account, a joint account, a second bank \u2014 that\u2019s where the real gaps usually hide. Same with utility bills. Show me what you pay for electricity, internet, or your phone and I can often find you a better deal within minutes.`

  const useCases = `People walk in here for all sorts of reasons. Some want to stop haemorrhaging money on bills and subscriptions they forgot they had. Some want to plan a trip they\u2019ve been putting off for three years and figure out how to actually afford it. Some want to understand their full net worth \u2014 what they own, what they owe, where they really stand. Some just want to know why their money disappears every month.`

  const invitation = `All of that is on the table. It all starts with a conversation.\n\n**What\u2019s on your mind today?**`

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

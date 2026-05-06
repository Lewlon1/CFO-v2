# Post-Onboarding Welcome Message & Action Chips

## Context

The final onboarding beat ("handoff") currently shows a flat one-liner — "Your office is set up. Explore at your own pace, or ask me anything right here" — followed by an "Enter the Office" button. This is the highest-intent moment in the user journey: they've spent 5+ minutes on the Value Map, uploaded statements, and just seen their first insight. The handoff should capitalise on that momentum by acknowledging what we've learned, reframing the product, and giving the user a clear next action.

## What We're Building

Replace the flat handoff message with:
1. A purpose-built welcome that references the user's archetype and data depth
2. Copy that reframes the product as a CFO, not a budgeting app
3. Four tappable action chips that dismiss onboarding and open chat with a first message

No new API routes. No schema changes. No new Bedrock calls. Pure app-layer wiring.

## Architecture

### Data flow

```
OnboardingModal (has state.data.archetypeData, transactionCount)
  └─ handoff beat renders WelcomeBeat component
       ├─ Calls buildWelcomeCopy() with archetype + months
       ├─ Renders paragraphs via ReactMarkdown (existing pattern)
       └─ Renders 4 action chips
            └─ On tap: calls onChipTap(chip)
                 └─ Parent dismisses onboarding + calls startConversation('chip_opener', { prompt })
                      └─ ChatProvider auto-trigger sends the chip prompt
                           └─ Claude responds via normal chat pipeline
```

### Chip → Chat entry (ChatProvider auto-trigger)

Uses the existing `startConversation(type, metadata)` mechanism in `ChatProvider.tsx`. A new trigger type `'chip_opener'` reads `metadata.prompt` as the user's first message. No sessionStorage, no new patterns.

## New Files

### `src/lib/onboarding/welcome-copy.ts`

Copy module + chip definitions. Keeps text separate from component logic.

```typescript
interface WelcomeCopyInput {
  archetypeName: string;
  archetypeSubtitle: string;
  monthsPhrase: string | null; // null if no transactions
}

interface WelcomeParagraphs {
  opening: string;
  transition: string;
  whatItIs: string;
  shareMore: string;
  useCases: string;
  invitation: string;
}

function buildWelcomeCopy(input: WelcomeCopyInput): WelcomeParagraphs
```

**Copy** (from the user's spec — these are final, do not reword):

- **opening** (with data): `Your Value Map said you're **{name}** — {subtitle}. That's a starting point, not a label. With {monthsPhrase} of your spending in front of me, I've already got a foundation to work from.`
- **opening** (no data): Same minus the "With X months..." sentence.
- **transition** (with data): `But a foundation isn't the full picture. The more I can see, the sharper my advice gets.`
- **transition** (no data): `The more I can see, the sharper my advice gets — and right now I'm working blind on your actual spending.`
- **whatItIs**: `Here's what this place is, and what it isn't. I'm not a budgeting app. I won't ping you when you overspend on coffee, and I won't make you fill in spreadsheets. I'm a CFO. My job is to look at your real numbers, spot the patterns you can't see from the inside, and help you make decisions that actually move you forward.`
- **shareMore**: `If you've got accounts I haven't seen yet — a credit card, a savings account, a joint account, a second bank — that's where the real gaps usually hide. Same with utility bills. Show me what you pay for electricity, internet, or your phone and I can often find you a better deal within minutes.`
- **useCases**: `People walk in here for all sorts of reasons. Some want to stop haemorrhaging money on bills and subscriptions they forgot they had. Some want to plan a trip they've been putting off for three years and figure out how to actually afford it. Some want to understand their full net worth — what they own, what they owe, where they really stand. Some just want to know why their money disappears every month.`
- **invitation**: `All of that is on the table. It all starts with a conversation.\n\n**What's on your mind today?**`

**Chip definitions:**

| id | label | prompt (sent to chat) | primary |
|----|-------|-----------------------|---------|
| `spending` | Show me where my money's going | Show me where my money's going. | yes |
| `bills` | Sort out my monthly bills | Help me sort out my monthly bills. | no |
| `add-account` | Add another account or card | I'd like to add another account or card so you can see the full picture. | no |
| `trip` | Plan a trip I keep delaying | I want to plan a trip I've been putting off. Help me figure out how to afford it. | no |

**Month phrase helper** (same file or split out):

```typescript
function formatMonthsPhrase(months: number): string | null
// 0 → null, 1 → "a month", 2 → "two months", 3 → "three months", 4+ → "{n} months"
```

Month count is derived from `state.data.transactionCount` and the insight data, or computed client-side from a quick count query. Since the insight engine already processes all transactions, we can derive months from the insight payload or call a lightweight endpoint.

### `src/components/onboarding/beats/WelcomeBeat.tsx`

Client component. Renders the welcome copy paragraphs and 4 action chips.

**Props:**
```typescript
interface WelcomeBeatProps {
  archetypeData?: ArchetypeData;
  monthsOfData: number;
  onChipTap: (chip: WelcomeChip) => void;
}
```

**Rendering:**
- Uses `ReactMarkdown` for bold text (same pattern as `InsightBeat`)
- Paragraphs spaced for readability (the copy is long — this is intentional)
- Chips rendered as full-width stacked buttons, minimum 44px height
- Primary chip gets `bg-[var(--accent-gold)] text-[var(--bg-base)]` styling
- Secondary chips get the existing `TappableOptions` outline style (`border border-[var(--border-subtle)]`)

## Modified Files

### `src/lib/onboarding/constants.ts`

Expand the handoff beat:

```typescript
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
```

### `src/components/onboarding/OnboardingModal.tsx`

- Import `useChatContext` to access `startConversation`
- Add `welcomeSlot` embed for the handoff beat (same pattern as `archetypeSlot` / `insightSlot`)
- Add `handleChipTap` callback: calls `dismiss()` then `startConversation('chip_opener', { prompt: chip.prompt })`
- Need to ensure `dismiss()` completes before `startConversation()` fires (await the dismiss, then trigger chat)

### `src/hooks/useOnboarding.ts`

No changes needed — `dismiss()` already returns a promise (it awaits the `/api/onboarding/complete` call). The caller can `await dismiss()` then call `startConversation`.

### `src/components/chat/ChatProvider.tsx`

Add `'chip_opener'` to the auto-trigger types array and handle it:

```typescript
} else if (type === 'chip_opener') {
  trigger = metadata?.prompt
    ? `[System: User just completed onboarding and tapped "${metadata.prompt}" as their first action. Respond to this directly — treat it as their opening message. Follow the first-post-onboarding instructions below.]`
    : '[System: User completed onboarding. Welcome them briefly and ask what they want to work on.]'
}
```

Add `'chip_opener'` to the `autoTriggerTypes` array.

### `src/lib/ai/context-builder.ts`

Add a `'chip_opener'` case to the conversation type switch that returns chip-specific instructions:

```
## Conversation type: First chat after onboarding

The user just completed the Value Map and uploaded transactions. Their first message
is from a tappable chip — respond to it directly.

- "Show me where my money's going." → Call get_spending_summary for the most recent
  month, lead with the single most surprising finding. One paragraph. Then ask one
  specific follow-up.

- "Help me sort out my monthly bills." → Surface what they're paying for recurring
  expenses, ask which one they'd most like to reduce.

- "I'd like to add another account or card..." → Don't call tools. Explain how to
  upload, what formats are accepted, what extra value they'll unlock. Three sentences.

- "I want to plan a trip I've been putting off..." → Don't call tools yet. Ask three
  questions: where, when, and approximate budget.

For any other opening, follow normal conversation instructions.
Keep the first response focused — one insight or one question. No lists, no feature
tours. Leave them wanting the next turn.
```

## Edge Cases

- **No archetype data** (user skipped Value Map): Use fallback — `archetypeName: "new here"`, `archetypeSubtitle: "let's figure it out together"`
- **Zero transactions** (user skipped uploads): `monthsPhrase` is null, copy uses the no-data variant
- **Chip tap + dismiss race condition**: `await dismiss()` before calling `startConversation()` to ensure the server has marked onboarding complete before the chat pipeline runs
- **User clicks "Enter the Office" instead of a chip**: Normal dismiss flow, no chat auto-trigger. User lands on the home screen and can open chat manually.

## What We're NOT Doing

- No archetype-aware chip personalisation (future extension)
- No sessionStorage mechanism
- No new API routes or Bedrock calls
- No schema changes
- No net worth chip (depends on user-entered assets that don't exist yet)

## Verification

1. Handoff beat shows the full welcome copy with archetype name in bold
2. With 0/1/2/3/5 months of data, the opening paragraph uses the correct phrasing
3. "What's on your mind today?" renders in bold at the end
4. All 4 chips render stacked, full-width, min 44px height
5. "Show me where my money's going" has primary (gold) styling
6. Tapping a chip dismisses onboarding and opens chat with the prompt as the first message
7. Claude responds appropriately to each chip prompt
8. Tapping "Enter the Office" (not a chip) dismisses normally without opening chat
9. With no archetype (Value Map skipped), fallback copy renders without crashing
10. With no transactions, no-data variant renders correctly

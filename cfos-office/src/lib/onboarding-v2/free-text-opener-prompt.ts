export function buildFreeTextOpenerPrompt(userText: string): string {
  return `The user has just signed up. As their first interaction, in response to "Where do you struggle most with your money?" they wrote:
"${userText}"

Respond as the CFO — direct, warm. Constraints:
- Acknowledge what they said specifically (no generic "Got it")
- Ask one clarifying question to understand their situation
- Observation only — no guidance, no suggestions, no recommendations yet
- Do not assume their numbers, country, family, or context
- Apply the standard remit boundary (no product recommendations, no buy/sell calls)
- No first-person ("I", "me", "my"); second person only
- Keep it under 60 words

Return only the response text. No preamble.`
}

export const FREE_TEXT_OPENER_FALLBACK =
  `Say more about what brought you in — what's been on your mind, and how long has it been weighing?`

// cfos-office/src/lib/chat/confirm-fact-parser.ts
//
// Pure parser for the [CONFIRM_FACT] block the CFO emits when it wants the user
// to confirm a single binary fact about a specific transaction (e.g. "The
// Hacienda PR payment is a tax debt"). The renderer turns it into a Yes / Not
// quite tap and — when the same message also carries an [OPTIONS] block — holds
// those option chips back until the fact is answered. Sibling to
// options-parser.ts; the system prompt bans OPTIONS for yes/no, so this fills
// that gap.

/**
 * Parse a chat message body and return { text, confirmFact } where:
 *   - text is the body with the [CONFIRM_FACT]…[/CONFIRM_FACT] block stripped
 *   - confirmFact is the statement to confirm (or null if no block found)
 *
 * The closing tag is optional — Claude frequently drops it — so a bare
 * `[CONFIRM_FACT]statement` to end-of-line is also accepted.
 */
export function parseConfirmFact(content: string): {
  text: string;
  confirmFact: string | null;
} {
  // Primary: explicit open + close. [\s\S] so the statement can span newlines.
  const closed = content.match(/\[CONFIRM_FACT\]\s*([\s\S]*?)\s*\[\/CONFIRM_FACT\]/);
  if (closed) {
    const fact = closed[1].trim();
    if (!fact) return { text: content, confirmFact: null };
    return { text: content.replace(closed[0], '').trim(), confirmFact: fact };
  }

  // Fallback: unclosed [CONFIRM_FACT]… runs to the end of its line.
  const open = content.match(/\[CONFIRM_FACT\]\s*([^\n]*)/);
  if (open) {
    const fact = open[1].trim();
    if (!fact) return { text: content, confirmFact: null };
    return { text: content.replace(open[0], '').trim(), confirmFact: fact };
  }

  return { text: content, confirmFact: null };
}

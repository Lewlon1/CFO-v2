// cfos-office/src/lib/chat/options-parser.ts
//
// Pure parsing helpers for the [OPTIONS] block emitted by the LLM in chat
// responses. Extracted from components/chat/MessageList.tsx so the
// server-side validators (Phase 6) and the client-side renderer share one
// implementation.
//
// Behaviour preserved verbatim from the inline copy in MessageList — the
// component still imports from here.

/**
 * Parse a chat message body and return { text, options } where:
 *   - text is the body with the [OPTIONS]…[/OPTIONS] block (or trailing
 *     bullet fallback) stripped
 *   - options is the list of chip strings (or null if no block found)
 *
 * Two acceptance shapes:
 *   1. Explicit marker: `[OPTIONS]\n- one\n- two\n[/OPTIONS]` (closing tag
 *      optional — the LLM frequently forgets it).
 *   2. Fallback: a trailing bullet list of 2–4 short non-numeric items at
 *      the end of the body. Skipped if items contain monetary values.
 */
export function parseOptions(content: string): { text: string; options: string[] | null } {
  // Primary: explicit [OPTIONS] blocks. Accept both closed and unclosed forms
  // — Claude frequently forgets the trailing [/OPTIONS] tag.
  const markerMatch = content.match(/\[OPTIONS\]\s*\n/);
  if (markerMatch && markerMatch.index !== undefined) {
    const markerStart = markerMatch.index;
    const afterMarker = markerStart + markerMatch[0].length;
    const tail = content.slice(afterMarker);
    const lines = tail.split('\n');

    const bulletLines: string[] = [];
    let consumedLines = 0;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        // Blank lines inside the block are allowed only between bullets.
        if (bulletLines.length === 0 || consumedLines === lines.length - 1) {
          consumedLines++;
          continue;
        }
        consumedLines++;
        continue;
      }
      if (/^[-•]\s+/.test(line)) {
        bulletLines.push(line.replace(/^[-•]\s*/, '').trim());
        consumedLines++;
      } else {
        break;
      }
    }

    // Trim trailing blank lines back off the consumed count so we don't eat
    // a blank separator that belongs to prose after the block.
    while (consumedLines > 0 && lines[consumedLines - 1].trim() === '') {
      consumedLines--;
    }

    if (bulletLines.length > 0 && bulletLines.length <= 5) {
      const consumedText = lines.slice(0, consumedLines).join('\n');
      // +1 for the newline after the last consumed line, if there is one.
      const hasTrailingNewline = consumedLines < lines.length;
      const consumedLength = consumedText.length + (hasTrailingNewline ? 1 : 0);

      let removeEnd = afterMarker + consumedLength;
      // Also consume an optional closing [/OPTIONS] tag immediately after.
      const closingMatch = content.slice(removeEnd).match(/^\s*\[\/OPTIONS\]\s*\n?/);
      if (closingMatch) {
        removeEnd += closingMatch[0].length;
      }

      const text = (content.slice(0, markerStart) + content.slice(removeEnd))
        .replace(/\[\/?OPTIONS\]/g, '')
        .trim();
      return { text, options: bulletLines };
    }
  }

  // Fallback: trailing bullet list of 2-4 short items that don't look like data.
  // The LLM sometimes forgets the explicit block — this catches "Would you like
  // to..." style responses while skipping spending breakdowns (monetary values).
  // Allow optional blank lines between bullets (markdown-style paragraphs).
  const trailing = content.match(/\n((?:[-•]\s+.{3,60}(?:\n\s*)?){2,4})$/);
  if (trailing) {
    const items = trailing[1]
      .split('\n')
      .map((l) => l.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean);
    const looksLikeChoices = items.every(
      (i) => i.length <= 60 && !/\d{2,}[.,]\d{2}/.test(i),
    );
    if (looksLikeChoices && items.length >= 2 && items.length <= 4) {
      const text = content
        .slice(0, content.length - trailing[0].length)
        .replace(/\[\/?OPTIONS\]/g, '')
        .trim();
      return { text, options: items };
    }
  }

  return { text: content, options: null };
}

/**
 * Does this message body contain an [OPTIONS] block (explicit or fallback)?
 * Cheap check used by the v2 validator to decide whether to run chip checks.
 */
export function hasOptionsBlock(text: string): boolean {
  return parseOptions(text).options !== null;
}

/**
 * Return the chip strings (the parsed bullet contents) from a message body.
 * Empty array if there's no block.
 */
export function extractChips(text: string): string[] {
  return parseOptions(text).options ?? [];
}

/**
 * Remove specific invalid chips from the [OPTIONS] block inside a message
 * body. If the block ends up empty, the whole block is removed.
 *
 * The function works on the original text — it preserves bullet style
 * (- or •) and surrounding prose. The matching is case-insensitive and
 * trims whitespace on both sides.
 *
 * Returns the modified text.
 */
export function removeInvalidChips(text: string, invalid: string[]): string {
  if (invalid.length === 0) return text;

  const invalidNormalised = new Set(invalid.map((s) => s.trim().toLowerCase()));

  // Locate the [OPTIONS] marker. If absent, try the trailing bullet fallback.
  const markerMatch = text.match(/\[OPTIONS\]\s*\n/);
  if (markerMatch && markerMatch.index !== undefined) {
    return removeFromExplicitBlock(text, markerMatch, invalidNormalised);
  }

  // Trailing fallback: try to identify the block via parseOptions and
  // surgically replace it.
  const trailing = text.match(/\n((?:[-•]\s+.{3,60}(?:\n\s*)?){2,4})$/);
  if (trailing) {
    const blockStart = text.length - trailing[0].length;
    const blockText = trailing[0];
    const lines = blockText.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
      const stripped = line.replace(/^[-•]\s*/, '').trim();
      if (!stripped) {
        kept.push(line);
        continue;
      }
      if (!invalidNormalised.has(stripped.toLowerCase())) {
        kept.push(line);
      }
    }
    const keptHasBullets = kept.some((l) => /^[-•]\s+/.test(l.trim()));
    if (!keptHasBullets) {
      // Block is now empty — drop the whole trailing block.
      return text.slice(0, blockStart).trimEnd();
    }
    return text.slice(0, blockStart) + kept.join('\n');
  }

  return text;
}

function removeFromExplicitBlock(
  text: string,
  markerMatch: RegExpMatchArray,
  invalidNormalised: Set<string>,
): string {
  const markerStart = markerMatch.index!;
  const afterMarker = markerStart + markerMatch[0].length;
  const tail = text.slice(afterMarker);
  const lines = tail.split('\n');

  // Determine how many lines belong to the [OPTIONS] block — same shape as
  // parseOptions.
  const consumedRaw: string[] = [];
  let consumedLines = 0;
  let sawBullet = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      consumedRaw.push(rawLine);
      consumedLines++;
      continue;
    }
    if (/^[-•]\s+/.test(line)) {
      consumedRaw.push(rawLine);
      consumedLines++;
      sawBullet = true;
    } else {
      break;
    }
  }
  if (!sawBullet) return text;

  // Trim trailing blanks (they belong to prose after).
  while (consumedRaw.length > 0 && consumedRaw[consumedRaw.length - 1].trim() === '') {
    consumedRaw.pop();
    consumedLines--;
  }

  // Filter bullet lines.
  const kept: string[] = [];
  for (const rawLine of consumedRaw) {
    const line = rawLine.trim();
    if (!line) {
      kept.push(rawLine);
      continue;
    }
    const stripped = line.replace(/^[-•]\s*/, '').trim();
    if (invalidNormalised.has(stripped.toLowerCase())) continue;
    kept.push(rawLine);
  }

  const keptHasBullets = kept.some((l) => /^[-•]\s+/.test(l.trim()));

  // Compute the consumed slice end.
  const consumedText = lines.slice(0, consumedLines).join('\n');
  const hasTrailingNewline = consumedLines < lines.length;
  const consumedLength = consumedText.length + (hasTrailingNewline ? 1 : 0);
  let removeEnd = afterMarker + consumedLength;
  // Match an optional [/OPTIONS] closing tag immediately after.
  const closingMatch = text.slice(removeEnd).match(/^\s*\[\/OPTIONS\]\s*\n?/);
  const hadClosingTag = !!closingMatch;
  if (closingMatch) {
    removeEnd += closingMatch[0].length;
  }

  if (!keptHasBullets) {
    // Empty block — drop [OPTIONS]\n…[/OPTIONS]\n entirely.
    const before = text.slice(0, markerStart).trimEnd();
    const after = text.slice(removeEnd);
    if (!after) return before;
    return `${before}\n${after}`;
  }

  // Re-emit the block with the same marker style.
  const replacement = `${markerMatch[0]}${kept.join('\n')}${hasTrailingNewline ? '\n' : ''}${hadClosingTag ? '[/OPTIONS]\n' : ''}`;
  return text.slice(0, markerStart) + replacement + text.slice(removeEnd);
}

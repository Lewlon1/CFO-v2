import type { ChatSignalType } from './types';

// Pattern library for Layer 4 signal extraction. First-pass before any LLM call.
// Confidences here are baseline — patterns matching unambiguous phrasing
// (regret, "worth it") get higher confidence than softer markers ("with mum").

type PatternEntry = {
  signal_type: ChatSignalType;
  patterns: RegExp[];
  confidence: number;
};

export const SIGNAL_PATTERNS: PatternEntry[] = [
  {
    signal_type: 'regret',
    confidence: 0.85,
    patterns: [
      /\b(shouldn'?t have|should not have)\b/i,
      /\bregret(?:ted|s|ting)?\b/i,
      /\bwaste(?:d)? (?:money|cash|that|of money)\b/i,
      /\b(?:total|complete) waste\b/i,
      /\bwish I hadn'?t\b/i,
      /\bguilty\b/i,
      /\bstupid (?:purchase|buy|decision)\b/i,
    ],
  },
  {
    signal_type: 'enjoyment',
    confidence: 0.85,
    patterns: [
      /\blov(?:e|ed|ing) (?:that|this|it)\b/i,
      /\bworth (?:it|every penny)\b/i,
      /\b(?:totally|completely) worth\b/i,
      /\btreat(?:ed myself)?\b/i,
      /\bneeded (?:that|this)\b/i,
      /\b(?:so|really) happy with\b/i,
      /\bbest (?:purchase|buy)\b/i,
    ],
  },
  {
    signal_type: 'context_person',
    confidence: 0.7,
    patterns: [
      /\bwith (?:my |a |the )?(mum|mom|dad|partner|wife|husband|friend|friends|family)\b/i,
      /\bfor (?:my |a |the )?(mum|mom|dad|partner|wife|husband|friend|family)(?:'s)?\b/i,
    ],
  },
  {
    signal_type: 'context_event',
    confidence: 0.75,
    patterns: [
      /\bfor (?:my |a |the )?(birthday|anniversary|wedding|christmas|holiday)\b/i,
      /\b(stag|hen) (?:do|night|party)\b/i,
    ],
  },
  {
    signal_type: 'context_situation',
    confidence: 0.7,
    patterns: [
      /\bafter work\b/i,
      /\bstressed\b/i,
      /\b(?:long|hard|tough|tired|exhausting) (?:day|week)\b/i,
      /\blazy\b/i,
      /\b(?:can'?t|couldn'?t) be bothered\b/i,
    ],
  },
];

export type PatternMatch = {
  signal_type: ChatSignalType;
  marker_phrase: string;
  confidence: number;
};

export function matchPatterns(text: string): PatternMatch[] {
  const hits: PatternMatch[] = [];
  for (const entry of SIGNAL_PATTERNS) {
    for (const pattern of entry.patterns) {
      const match = text.match(pattern);
      if (match) {
        hits.push({
          signal_type: entry.signal_type,
          marker_phrase: match[0],
          confidence: entry.confidence,
        });
      }
    }
  }
  return hits;
}

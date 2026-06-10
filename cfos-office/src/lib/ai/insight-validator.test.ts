import { describe, it, expect } from 'vitest';
import {
  extractNumbers,
  extractMerchants,
  validateNarrative,
  validateLength,
  appendCorrection,
  stripValidatorNote,
  DEFAULT_BODY_WORD_CAP,
} from './insight-validator';
import type { QuotableFact } from '@/lib/analytics/insight-types';

describe('extractNumbers', () => {
  it('extracts integers', () => {
    expect(extractNumbers('You spent 3300 on housing')).toEqual([3300]);
  });

  it('extracts decimals', () => {
    expect(extractNumbers('Gym costs 29.99 a month')).toEqual([29.99]);
  });

  it('ignores commas in thousand separators', () => {
    expect(extractNumbers('£3,300 on housing')).toEqual([3300]);
  });

  it('strips currency symbols', () => {
    expect(extractNumbers('€500 to Vanguard and $20 to coffee')).toEqual([500, 20]);
  });

  it('ignores numbers below 10 (pronouns like "one", "two")', () => {
    expect(extractNumbers('one of five things is that 3300 on rent')).toEqual([3300]);
  });

  it('returns empty for text with no numbers', () => {
    expect(extractNumbers('no numbers here at all')).toEqual([]);
  });

  it('preserves percentage numerators as-is (they are checkable too)', () => {
    expect(extractNumbers('69% of your spend')).toEqual([69]);
  });
});

describe('extractMerchants', () => {
  const knownMerchants = ['glovo', 'deliveroo', 'netflix', 'vanguard', 'puregym'];

  it('matches case-insensitively', () => {
    expect(extractMerchants('You spent £18 on Glovo and £22 on Deliveroo.', knownMerchants))
      .toEqual(['glovo', 'deliveroo']);
  });

  it('matches as whole words only', () => {
    // "vanguardian" should not match "vanguard"
    expect(extractMerchants('vanguardian is not vanguard', knownMerchants))
      .toEqual(['vanguard']);
  });

  it('returns each match once even when mentioned multiple times', () => {
    expect(extractMerchants('Netflix. Netflix. Netflix.', knownMerchants))
      .toEqual(['netflix']);
  });

  it('returns empty for no matches', () => {
    expect(extractMerchants('grocery trips and bus fares', knownMerchants))
      .toEqual([]);
  });

  it('handles empty merchant list', () => {
    expect(extractMerchants('anything', [])).toEqual([]);
  });
});

describe('validateNarrative', () => {
  const facts: QuotableFact[] = [
    { text: '£3,300 on housing', numbers: [3300], merchants: [] },
    { text: '64% of your spend', numbers: [64], merchants: [] },
    { text: '£500 a month to Vanguard', numbers: [500], merchants: ['vanguard'] },
  ];

  it('passes when narrative only cites allowed numbers and merchants', () => {
    const narrative = 'You put £3,300 on housing and £500 a month to Vanguard. Overall, 64% of your spend went to housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('fails when narrative cites a number not in any fact', () => {
    const narrative = 'You spent 20 a month on coffee and 3300 on housing.';
    const result = validateNarrative(narrative, facts);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('numbers_not_allowed');
      expect(result.offenders).toContain('20');
    }
  });

  it('fails when narrative names a merchant not in any fact', () => {
    const narrative = 'You subscribe to Netflix and put £500 to Vanguard.';
    const result = validateNarrative(narrative, facts, { knownMerchants: ['netflix', 'vanguard'] });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('merchants_not_allowed');
      expect(result.offenders).toContain('netflix');
    }
  });

  it('ignores the transaction-count context fact when not provided', () => {
    // When knownMerchants is not passed, no merchant check runs.
    const narrative = 'A big number here: 3300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });
});

describe('validateNarrative — ±1 tolerance', () => {
  const facts: QuotableFact[] = [
    { text: '30 a month', numbers: [30], merchants: [] },
    { text: '£3,300 on housing', numbers: [3300], merchants: [] },
  ];

  it('accepts a cited number within ±1 of an allowed number (rounding)', () => {
    // Narrative cites £29.99; allowlist has 30. extractNumbers yields 29.99,
    // |29.99 - 30| = 0.01, within tolerance.
    const narrative = 'Gym is £29.99 a month and £3,300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('accepts a cited number exactly ±1 from an allowed number', () => {
    // Narrative cites 31; allowlist has 30. |31 - 30| = 1, at boundary.
    const narrative = 'Around 31 a month and £3,300 on housing.';
    expect(validateNarrative(narrative, facts)).toEqual({ ok: true });
  });

  it('rejects a cited number more than 1 away from any allowed number', () => {
    // Narrative cites 35; allowlist has only 30 and 3300. |35-30|=5, |35-3300|=3265.
    const narrative = 'Around 35 a month on something.';
    const result = validateNarrative(narrative, facts);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('numbers_not_allowed');
      expect(result.offenders).toContain('35');
    }
  });
});

describe('validateLength', () => {
  it('passes when body word count is under the cap', () => {
    const narrative = 'Short body. Three sentences total.';
    const result = validateLength(narrative);
    expect(result.valid).toBe(true);
    expect(result.word_count).toBe(5);
    expect(result.cap).toBe(180);
  });

  it('passes when body word count is exactly at the cap', () => {
    const narrative = Array(180).fill('word').join(' ');
    const result = validateLength(narrative);
    expect(result.valid).toBe(true);
    expect(result.word_count).toBe(180);
  });

  it('fails when body word count exceeds the cap', () => {
    const narrative = Array(225).fill('word').join(' ');
    const result = validateLength(narrative);
    expect(result.valid).toBe(false);
    expect(result.word_count).toBe(225);
    expect(result.cap).toBe(180);
  });

  it('strips [OPTIONS]...[/OPTIONS] block before counting', () => {
    const body = Array(50).fill('body').join(' ');
    const chips = Array(50).fill('chip').join(' ');
    const narrative = `${body}\n[OPTIONS]\n- ${chips}\n[/OPTIONS]`;
    const result = validateLength(narrative);
    expect(result.word_count).toBe(50);
    expect(result.valid).toBe(true);
  });

  it('strips signoff line "— C." before counting', () => {
    const narrative = `Body text here.\n\n— C.`;
    const result = validateLength(narrative);
    expect(result.word_count).toBe(3);
  });

  it('honours an explicit cap parameter', () => {
    const narrative = Array(50).fill('word').join(' ');
    expect(validateLength(narrative, 40).valid).toBe(false);
    expect(validateLength(narrative, 100).valid).toBe(true);
  });

  it('exposes DEFAULT_BODY_WORD_CAP for downstream callers', () => {
    expect(DEFAULT_BODY_WORD_CAP).toBe(180);
  });
});

describe('appendCorrection — length_violation', () => {
  it('appends a length-violation note when length_violation.valid is false', () => {
    const out = appendCorrection('Original body.', {
      length_violation: { valid: false, word_count: 225, cap: 180 },
    });
    expect(out).toContain('body length 225 words');
    expect(out).toContain('cap 180');
    expect(out).toContain('System note');
  });

  it('does NOT append anything when length_violation.valid is true', () => {
    const out = appendCorrection('Original body.', {
      length_violation: { valid: true, word_count: 100, cap: 180 },
    });
    expect(out).toBe('Original body.');
  });

  it('combines length violation with other v2 violations into one note', () => {
    const out = appendCorrection('Original body.', {
      voice_violations: ['I noticed'],
      length_violation: { valid: false, word_count: 200, cap: 180 },
    });
    expect(out).toContain('1 voice phrase');
    expect(out).toContain('body length 200 words');
  });
});

describe('stripValidatorNote', () => {
  it('round-trips appendCorrection: removes an appended System note + its separator', () => {
    const body = 'Your free cash flow is the number to watch.';
    const withNote = appendCorrection(body, {
      unmatched_citations: { numbers: ['1233', '677', '556'], merchants: [] },
      unmatched_projections: ['saved 200/year'],
    });
    expect(withNote).toContain('System note'); // precondition: a note was appended
    expect(stripValidatorNote(withNote)).toBe(body);
  });

  it('removes a model-echoed passive-voice note (no "I flagged")', () => {
    const echoed =
      'Same group, same trip?\n\n[OPTIONS]\n- Yes\n- No\n[/OPTIONS]\n\n---\n\n' +
      '_(System note: 2 issues flagged in this message. 3 numbers not grounded in tool output, 1 projection not backed by an experiment.)_';
    expect(stripValidatorNote(echoed)).toBe(
      'Same group, same trip?\n\n[OPTIONS]\n- Yes\n- No\n[/OPTIONS]',
    );
  });

  it('removes a length-violation note containing inner parentheses', () => {
    const withNote =
      'Body.\n\n---\n\n_(System note: I flagged 1 issue in this message. body length 225 words (cap 180).)_';
    expect(stripValidatorNote(withNote)).toBe('Body.');
  });

  it('leaves a clean message with a legitimate horizontal rule untouched', () => {
    const clean = 'Part one.\n\n---\n\nPart two.';
    expect(stripValidatorNote(clean)).toBe(clean);
  });

  it('returns clean messages unchanged', () => {
    expect(stripValidatorNote('Nothing to strip here.')).toBe('Nothing to strip here.');
  });

  it('handles the empty string', () => {
    expect(stripValidatorNote('')).toBe('');
  });
});

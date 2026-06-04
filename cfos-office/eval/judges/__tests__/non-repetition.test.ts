import { describe, it, expect } from 'vitest';
import { nonRepetitionScore } from '../2026-05-17-baseline';

describe('nonRepetitionScore', () => {
  it('returns 1.0 for a non-recompose (no open_chat CTA)', () => {
    const text = 'Here is your first read. [CTA:start_value_map_real]Tell me what these mean[/CTA]\n\n— C.';
    expect(nonRepetitionScore(text).score).toBe(1);
  });

  it('returns 1.0 for a clean delta recompose', () => {
    const text =
      'Your sorting just made the picture legible — dining is your biggest leak now.\n[CTA:open_chat]Let\'s sort what\'s uncategorised[/CTA]\n\n— C.';
    const res = nonRepetitionScore(text);
    expect(res.score).toBe(1);
    expect(res.notes).toEqual([]);
  });

  it('penalises a recompose that opens a second hook', () => {
    const text =
      'I can see Uber but I can\'t read it without you.\n[CTA:open_chat]Show me[/CTA]\n[CTA:start_value_map_real]Tell me what these mean[/CTA]\n\n— C.';
    const res = nonRepetitionScore(text);
    expect(res.score).toBeLessThan(1);
    expect(res.notes.join(' ')).toMatch(/second hook/);
  });

  it('penalises a recompose that re-opens on Layer 1', () => {
    const text =
      'Your free cash flow is 1200 a month. The clock is running.\n[CTA:open_chat]Continue[/CTA]\n\n— C.';
    const res = nonRepetitionScore(text);
    expect(res.score).toBeLessThan(1);
    expect(res.notes.join(' ')).toMatch(/Layer 1/);
  });
});

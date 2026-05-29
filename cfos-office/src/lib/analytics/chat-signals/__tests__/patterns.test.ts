import { describe, it, expect } from 'vitest';
import { matchPatterns } from '../patterns';

describe('matchPatterns — regret', () => {
  it.each([
    "ugh I shouldn't have ordered that",
    'I regret buying that subscription',
    'such a waste of money',
    'total waste honestly',
    'wish I hadn\'t got that',
    'felt guilty afterwards',
    'stupid purchase, never again',
  ])('matches "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'regret')).toBe(true);
  });

  it.each([
    'I love that purchase',
    'I went shopping yesterday',
  ])('does NOT match "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'regret')).toBe(false);
  });
});

describe('matchPatterns — enjoyment', () => {
  it.each([
    'I love that gym membership',
    'worth every penny',
    'totally worth it',
    'treated myself to a coffee',
    'I really needed that',
    'so happy with the new headphones',
    'best purchase this year',
  ])('matches "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'enjoyment')).toBe(true);
  });

  it.each([
    'I regret that',
    'I bought a sandwich',
  ])('does NOT match "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'enjoyment')).toBe(false);
  });
});

describe('matchPatterns — context_person', () => {
  it.each([
    'went out with mum yesterday',
    'shopping with friends',
    'for my partner',
    'bought it for dad',
  ])('matches "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'context_person')).toBe(true);
  });

  it('does NOT match an unrelated mention', () => {
    const hits = matchPatterns('went to the supermarket');
    expect(hits.some(h => h.signal_type === 'context_person')).toBe(false);
  });
});

describe('matchPatterns — context_event', () => {
  it.each([
    'for my birthday',
    'for the wedding next month',
    'stag do last weekend',
    'hen night was expensive',
  ])('matches "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'context_event')).toBe(true);
  });

  it('does NOT match generic spending', () => {
    const hits = matchPatterns('regular grocery shop');
    expect(hits.some(h => h.signal_type === 'context_event')).toBe(false);
  });
});

describe('matchPatterns — context_situation', () => {
  it.each([
    'after work I just ordered Deliveroo',
    'I was stressed',
    'long day so I treated myself',
    'tough week',
    'couldn\'t be bothered to cook',
    'too lazy to make dinner',
  ])('matches "%s"', (text) => {
    const hits = matchPatterns(text);
    expect(hits.some(h => h.signal_type === 'context_situation')).toBe(true);
  });
});

describe('matchPatterns — multi-signal aggregation', () => {
  it('returns multiple signals when the message contains several markers', () => {
    const hits = matchPatterns('after work I treated myself to Deliveroo and I regret it');
    const types = new Set(hits.map(h => h.signal_type));
    expect(types.has('regret')).toBe(true);
    expect(types.has('enjoyment')).toBe(true);
    expect(types.has('context_situation')).toBe(true);
  });

  it('returns empty array for a neutral message', () => {
    const hits = matchPatterns('paid the electricity bill today');
    expect(hits).toEqual([]);
  });
});

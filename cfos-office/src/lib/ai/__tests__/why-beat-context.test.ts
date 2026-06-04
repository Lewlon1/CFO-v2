import { describe, it, expect } from 'vitest';
import { renderWhyBeatBlock, buildWhyBeatContext } from '../context-builder';
import type { SignificantMerchant } from '@/lib/value-map/significant-merchant';

const merchant: SignificantMerchant = {
  merchantKey: 'uber',
  displayName: 'Uber',
  salienceScore: 0.5,
  userConfidence: 2,
  likelyDivergence: true,
};

describe('renderWhyBeatBlock (framing rule)', () => {
  it('frames as a read-and-confirm, not a justify-the-spend demand', () => {
    const block = renderWhyBeatBlock(merchant);
    expect(block).toContain('read-and-confirm');
    expect(block).toContain('Offer a READ and invite correction');
    // The justify phrasing is explicitly banned in the rule text.
    expect(block).toContain('BANNED');
    expect(block).toContain('Why do you spend so much on Uber?');
    expect(block).toContain('JUSTIFY');
    // Use-once / drop-if-deflected discipline is present.
    expect(block).toContain('Do this ONCE');
    expect(block).toContain('drop it');
  });
});

describe('buildWhyBeatContext gating', () => {
  it('returns empty when the conversation is not a first_read thread', async () => {
    const out = await buildWhyBeatContext('u1', 'chat', {
      first_read_metadata_recomposed: {},
    });
    expect(out).toBe('');
  });

  it('returns empty when the recompose has not been delivered', async () => {
    const out = await buildWhyBeatContext('u1', 'first_read', {});
    expect(out).toBe('');
  });

  it('returns empty when why_beat_offered is already set', async () => {
    const out = await buildWhyBeatContext('u1', 'first_read', {
      first_read_metadata_recomposed: {},
      why_beat_offered: true,
    });
    expect(out).toBe('');
  });
});

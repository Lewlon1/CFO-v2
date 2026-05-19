import { describe, expect, it } from 'vitest';

import {
  computeActiveLimit,
  computeCompletionStats,
  type CompletedStatus,
} from '../limit';

describe('computeCompletionStats', () => {
  it('returns zeros for empty input', () => {
    const s = computeCompletionStats([]);
    expect(s).toEqual({ window: 0, succeeded: 0, partial: 0, failed: 0, rate: 0 });
  });

  it('counts succeeded + partial toward the rate', () => {
    const s = computeCompletionStats(['succeeded', 'partial', 'failed', 'succeeded']);
    expect(s.window).toBe(4);
    expect(s.succeeded).toBe(2);
    expect(s.partial).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.rate).toBeCloseTo(0.75, 10);
  });

  it('caps the window at the last 4 entries', () => {
    const eight: CompletedStatus[] = [
      'failed', 'failed', 'failed', 'failed',
      'succeeded', 'succeeded', 'succeeded', 'succeeded',
    ];
    const s = computeCompletionStats(eight);
    expect(s.window).toBe(4);
    expect(s.failed).toBe(4);
    expect(s.succeeded).toBe(0);
    expect(s.rate).toBe(0);
  });
});

describe('computeActiveLimit', () => {
  it('returns 1 for brand-new users with no completed history', () => {
    const limit = computeActiveLimit(computeCompletionStats([]));
    expect(limit).toBe(1);
  });

  it('returns 1 when nothing has completed in the window', () => {
    const limit = computeActiveLimit(computeCompletionStats(['failed', 'failed']));
    expect(limit).toBe(1);
  });

  it('returns 2 with a mid-range completion rate', () => {
    const limit = computeActiveLimit(
      computeCompletionStats(['succeeded', 'failed', 'failed', 'failed']),
    );
    // rate = 0.25 → ceil(0.75) = 1 → max(1, min(3, 1)) = 1
    expect(limit).toBe(1);

    const limit2 = computeActiveLimit(
      computeCompletionStats(['succeeded', 'partial', 'failed', 'failed']),
    );
    // rate = 0.5 → ceil(1.5) = 2
    expect(limit2).toBe(2);
  });

  it('returns 3 at full completion', () => {
    const limit = computeActiveLimit(
      computeCompletionStats(['succeeded', 'succeeded', 'succeeded', 'succeeded']),
    );
    expect(limit).toBe(3);
  });

  it('returns 3 with a single succeeded outcome', () => {
    // window=1, rate=1 → ceil(3) = 3
    const limit = computeActiveLimit(computeCompletionStats(['succeeded']));
    expect(limit).toBe(3);
  });

  it('never exceeds 3', () => {
    const limit = computeActiveLimit({
      window: 10, succeeded: 10, partial: 0, failed: 0, rate: 1.0,
    });
    expect(limit).toBe(3);
  });

  it('never drops below 1', () => {
    const limit = computeActiveLimit({
      window: 1, succeeded: 0, partial: 0, failed: 1, rate: 0,
    });
    expect(limit).toBe(1);
  });
});

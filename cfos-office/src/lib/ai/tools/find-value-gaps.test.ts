import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as gapAnalyser from '@/lib/analytics/gap-analyser';
import { createFindValueGapsTool } from './find-value-gaps';

// Mock the underlying analyser. The tool is a thin pass-through; mocking the
// analyser lets us assert the wrapper's shape and error-handling cleanly.
vi.mock('@/lib/analytics/gap-analyser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics/gap-analyser')>();
  return {
    ...actual,
    analyseGapV2: vi.fn(),
  };
});

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    supabase: {} as unknown as SupabaseClient,
    userId: 'user-123',
    conversationId: 'conv-1',
    currency: 'EUR',
    ...overrides,
  };
}

const analyseGapV2 = vi.mocked(gapAnalyser.analyseGapV2);

beforeEach(() => {
  analyseGapV2.mockReset();
});

describe('createFindValueGapsTool', () => {
  it('calls analyseGapV2 with the supplied months and returns its result + currency', async () => {
    analyseGapV2.mockResolvedValueOnce({
      gaps: [],
      value_map_metadata: {
        baseline_taken_at: null,
        classifications_count: 0,
        decided_count: 0,
        unsure_count: 0,
        staleness_days: 0,
        coverage_pct: 0,
        unclassified_categories: [],
      },
      has_value_map: false,
    });

    const tool = createFindValueGapsTool(makeCtx({ currency: 'GBP' }));
    const result = await tool.execute({ months: 6 });

    expect(analyseGapV2).toHaveBeenCalledTimes(1);
    expect(analyseGapV2).toHaveBeenCalledWith(expect.anything(), 'user-123', 6);
    expect(result).toMatchObject({
      has_value_map: false,
      gaps: [],
      currency: 'GBP',
    });
    expect('value_map_metadata' in (result as Record<string, unknown>)).toBe(true);
  });

  it('uses the default months (3) when not provided', () => {
    const tool = createFindValueGapsTool(makeCtx());
    const parsed = tool.inputSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.months).toBe(3);
    }
  });

  it('returns a friendly error string when the analyser throws', async () => {
    analyseGapV2.mockRejectedValueOnce(new Error('boom'));
    const tool = createFindValueGapsTool(makeCtx());

    const result = await tool.execute({ months: 3 });
    expect(result).toEqual({
      error: 'Could not compute value gaps. Please try again.',
    });
  });
});

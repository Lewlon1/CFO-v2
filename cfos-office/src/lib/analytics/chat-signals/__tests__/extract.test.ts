import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be hoisted before importing the unit under test
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: (rows: unknown[]) => {
        capturedInserts.push(...(rows as Record<string, unknown>[]));
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

vi.mock('@/lib/ai/provider', () => ({
  utilityModel: { mock: true },
  utilityModelId: 'mock-haiku-id',
}));

vi.mock('ai', async () => {
  // Returning a value-by-default mock; individual tests override via mockResolvedValueOnce
  return {
    generateObject: vi.fn(async () => ({ object: { signals: [] } })),
  };
});

import { extractAndStoreSignals } from '../extract';
import * as aiSdk from 'ai';

const capturedInserts: Record<string, unknown>[] = [];

beforeEach(() => {
  capturedInserts.length = 0;
  vi.clearAllMocks();
});

describe('extractAndStoreSignals', () => {
  it('stores pattern hits without calling LLM when pattern confidence is high', async () => {
    const result = await extractAndStoreSignals({
      userId: 'u1',
      messageId: 'm1',
      messageText: "I really regret ordering Deliveroo last night, total waste",
      recentMerchants: ['POS PURCHASE DELIVEROO'],
    });

    expect(result.stored).toBeGreaterThan(0);
    expect(result.usedLlm).toBe(false);
    expect(capturedInserts.length).toBeGreaterThan(0);
    expect(capturedInserts[0].signal_type).toBe('regret');
    expect(capturedInserts[0].extraction_method).toBe('pattern');
    expect(capturedInserts[0].user_id).toBe('u1');
    expect(capturedInserts[0].message_id).toBe('m1');
  });

  it('attributes target_merchant from recentMerchants when name appears in message', async () => {
    await extractAndStoreSignals({
      userId: 'u1',
      messageId: 'm1',
      messageText: "I regret ordering from Deliveroo yesterday",
      recentMerchants: ['POS PURCHASE DELIVEROO #142'],
    });
    expect(capturedInserts[0].target_merchant).toBe('POS PURCHASE DELIVEROO #142');
  });

  it('falls back to LLM when no pattern matches and adds llm-tagged signals', async () => {
    vi.mocked(aiSdk.generateObject).mockResolvedValueOnce({
      object: {
        signals: [
          {
            signal_type: 'regret' as const,
            marker_phrase: 'might have overdone it',
            target_merchant: 'PRET',
            target_category: null,
            confidence: 0.75,
          },
        ],
      },
      // generateObject returns more fields; we cast through unknown for the mock shape
    } as unknown as Awaited<ReturnType<typeof aiSdk.generateObject>>);

    const result = await extractAndStoreSignals({
      userId: 'u1',
      messageId: 'm1',
      messageText: 'spent a lot at Pret this week, might have overdone it',
      recentMerchants: ['PRET'],
    });

    expect(result.usedLlm).toBe(true);
    expect(capturedInserts.some(r => r.extraction_method === 'llm')).toBe(true);
  });

  it('stores zero signals on a neutral message', async () => {
    const result = await extractAndStoreSignals({
      userId: 'u1',
      messageId: 'm1',
      messageText: 'paid the electricity bill today',
      recentMerchants: [],
    });

    // LLM fallback may be called but our default mock returns empty signals
    expect(result.stored).toBe(0);
    expect(capturedInserts.length).toBe(0);
  });

  it('survives LLM failure when pattern hits are present', async () => {
    vi.mocked(aiSdk.generateObject).mockRejectedValueOnce(new Error('LLM down'));

    const result = await extractAndStoreSignals({
      userId: 'u1',
      messageId: 'm1',
      messageText: 'with my mum at lunch', // pattern only (context_person, conf 0.7)
      recentMerchants: [],
    });

    // Pattern hits should still land
    expect(result.stored).toBeGreaterThan(0);
    expect(capturedInserts[0].signal_type).toBe('context_person');
  });

  it('does not duplicate when pattern and LLM identify the same marker', async () => {
    vi.mocked(aiSdk.generateObject).mockResolvedValueOnce({
      object: {
        signals: [
          {
            signal_type: 'regret' as const,
            marker_phrase: "shouldn't have", // duplicate of pattern hit
            target_merchant: null,
            target_category: null,
            confidence: 0.9,
          },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof aiSdk.generateObject>>);

    // Low-confidence pattern that triggers LLM fallback (context_person, conf 0.7 below 0.7 threshold? No — 0.7 = threshold)
    // Force LLM via no pattern match? Use a message that has context_person at exactly 0.7:
    await extractAndStoreSignals({
      userId: 'u1',
      messageId: 'm1',
      messageText: "with mum I shouldn't have", // context_person + regret patterns
      recentMerchants: [],
    });

    const regretInserts = capturedInserts.filter(r => r.signal_type === 'regret');
    // Pattern matched "shouldn't have" with confidence 0.85; LLM returned same phrase
    // After dedup, should be 1
    expect(regretInserts.length).toBe(1);
  });
});

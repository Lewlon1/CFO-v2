import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildUserValueProfile, MIN_SIGNAL_FOR_CONFIDENCE } from '../value-profile';

interface RuleRow {
  match_value: string;
  value_category: string;
  source: string;
  match_type: string;
}

interface TxRow {
  category_id: string | null;
  value_category: string | null;
  value_confirmed_by_user: boolean;
}

interface SessionRow {
  id: string;
}

function makeSupabaseStub(opts: {
  rules?: RuleRow[];
  transactions?: TxRow[];
  sessions?: SessionRow[];
}) {
  const finalisers: Record<string, () => Promise<unknown>> = {
    value_category_rules: () =>
      Promise.resolve({ data: opts.rules ?? [], error: null }),
    transactions: () =>
      Promise.resolve({ data: opts.transactions ?? [], error: null }),
    value_map_sessions: () =>
      Promise.resolve({ data: opts.sessions ?? [], error: null }),
  };

  return {
    from: vi.fn((table: string) => {
      const finalise = finalisers[table];
      if (!finalise) throw new Error(`unmocked table: ${table}`);
      const builder: Record<string, unknown> = {};
      const chain = ['select', 'eq', 'in', 'is', 'not', 'limit'];
      for (const method of chain) {
        builder[method] = vi.fn(() => builder);
      }
      // Make builder thenable so awaiting the chain resolves to the data.
      (builder as { then: unknown }).then = (
        onFulfilled: (v: unknown) => unknown,
      ) => finalise().then(onFulfilled);
      return builder;
    }),
  } as unknown as SupabaseClient;
}

describe('buildUserValueProfile', () => {
  it('returns empty profile when user has no data', async () => {
    const supabase = makeSupabaseStub({});
    const profile = await buildUserValueProfile(supabase, 'user-1');
    expect(profile.by_category).toEqual({});
    expect(profile.signal_count).toEqual({});
    expect(profile.has_value_map).toBe(false);
    expect(profile.has_any_leak_signal).toBe(false);
  });

  it('marks has_value_map=true when a non-deleted session exists', async () => {
    const supabase = makeSupabaseStub({ sessions: [{ id: 's1' }] });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    expect(profile.has_value_map).toBe(true);
  });

  it('weights rules 2x transactions and normalises to shares', async () => {
    const supabase = makeSupabaseStub({
      rules: [
        // 2 rules × weight 2 = 4 foundation signals
        { match_value: 'eat_drinking_out', value_category: 'foundation', source: 'value_map', match_type: 'category' },
        { match_value: 'eat_drinking_out', value_category: 'foundation', source: 'value_map', match_type: 'category' },
      ],
      transactions: [
        // 2 transactions × weight 1 = 2 leak signals
        { category_id: 'eat_drinking_out', value_category: 'leak', value_confirmed_by_user: true },
        { category_id: 'eat_drinking_out', value_category: 'leak', value_confirmed_by_user: true },
      ],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    // 4 foundation + 2 leak = 6 total. Foundation share = 4/6, leak = 2/6.
    expect(profile.by_category.eat_drinking_out.foundation).toBeCloseTo(4 / 6, 5);
    expect(profile.by_category.eat_drinking_out.leak).toBeCloseTo(2 / 6, 5);
    expect(profile.by_category.eat_drinking_out.investment).toBe(0);
    expect(profile.by_category.eat_drinking_out.burden).toBe(0);
    expect(profile.signal_count.eat_drinking_out).toBe(6);
  });

  it('omits low-signal categories from by_category but keeps them in signal_count', async () => {
    const supabase = makeSupabaseStub({
      rules: [
        // 1 rule × 2 = 2 weighted signals, below MIN_SIGNAL_FOR_CONFIDENCE=3
        { match_value: 'subscriptions', value_category: 'leak', source: 'value_map', match_type: 'category' },
      ],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    expect(profile.by_category.subscriptions).toBeUndefined();
    expect(profile.signal_count.subscriptions).toBe(2);
    expect(profile.signal_count.subscriptions).toBeLessThan(MIN_SIGNAL_FOR_CONFIDENCE);
  });

  it('sets has_any_leak_signal=true when any category has any leak signal', async () => {
    const supabase = makeSupabaseStub({
      transactions: [
        // single leak signal, below threshold but still flips the flag
        { category_id: 'subscriptions', value_category: 'leak', value_confirmed_by_user: true },
      ],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    expect(profile.has_any_leak_signal).toBe(true);
  });

  it('skips unsure and unexpected quadrants', async () => {
    const supabase = makeSupabaseStub({
      rules: [
        { match_value: 'health', value_category: 'foundation', source: 'value_map', match_type: 'category' },
        { match_value: 'health', value_category: 'foundation', source: 'value_map', match_type: 'category' },
        { match_value: 'health', value_category: 'unsure', source: 'value_map', match_type: 'category' },
        { match_value: 'health', value_category: 'gibberish', source: 'value_map', match_type: 'category' },
      ],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    // Only the 2 foundation rules survive: 2 × weight 2 = 4 signals
    expect(profile.signal_count.health).toBe(4);
    expect(profile.by_category.health.foundation).toBe(1);
  });

  it('surfaces a category with a single user-confirmed signal, bypassing MIN_SIGNAL', async () => {
    // A deliberate user classification (value_confirmed_by_user=true) is
    // confident on its own. The MIN_SIGNAL gate exists to suppress thin
    // AI-suggested signal, not to bury a category the user explicitly sorted —
    // so one confirmed transaction (weight 1, below the threshold of 3) still
    // surfaces its category. This is what lets a merchant the user marked
    // (back-propagated onto its transaction at classify time) reach the
    // category-level value profile the first Read reads.
    const supabase = makeSupabaseStub({
      transactions: [
        { category_id: 'eat_drinking_out', value_category: 'investment', value_confirmed_by_user: true },
      ],
      sessions: [{ id: 's1' }],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    expect(profile.by_category.eat_drinking_out.investment).toBe(1);
    expect(profile.signal_count.eat_drinking_out).toBe(1);
    expect(profile.signal_count.eat_drinking_out).toBeLessThan(MIN_SIGNAL_FOR_CONFIDENCE);
  });

  it('still gates a low-signal category that has only a rule and no confirmed transaction', async () => {
    // The exemption is for user-confirmed TRANSACTIONS only. A lone category
    // rule (weight 2, below threshold) with no confirmed transaction stays
    // gated — rules can be thin/AI-seeded, so the threshold still applies.
    const supabase = makeSupabaseStub({
      rules: [
        { match_value: 'subscriptions', value_category: 'leak', source: 'value_map', match_type: 'category' },
      ],
      sessions: [{ id: 's1' }],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');
    expect(profile.by_category.subscriptions).toBeUndefined();
    expect(profile.signal_count.subscriptions).toBe(2);
  });

  it('aggregates merchant rules from the real-transactions Value Map into by_merchant', async () => {
    // The value-first onboarding writes one rule per merchant with
    // source='value_map_personal' and match_type='merchant'. Earlier code
    // filtered both out of the profile, so the recompose never knew the
    // user had categorised them. This test pins the fix.
    const supabase = makeSupabaseStub({
      rules: [
        { match_value: 'aldi', value_category: 'foundation', source: 'value_map_personal', match_type: 'merchant' },
        { match_value: 'claude.ai', value_category: 'investment', source: 'value_map_personal', match_type: 'merchant' },
      ],
      sessions: [{ id: 's1' }],
    });
    const profile = await buildUserValueProfile(supabase, 'user-1');

    // Merchants land in the merchant dictionaries with no MIN threshold —
    // one rule = mapped.
    expect(profile.by_merchant.aldi.foundation).toBe(1);
    expect(profile.by_merchant['claude.ai'].investment).toBe(1);
    expect(profile.signal_count_by_merchant.aldi).toBe(2); // 1 rule × RULE_WEIGHT=2
    expect(profile.signal_count_by_merchant['claude.ai']).toBe(2);

    // Category dicts stay empty — merchant rules don't bleed into them.
    expect(profile.by_category).toEqual({});
    expect(profile.signal_count).toEqual({});
  });
});

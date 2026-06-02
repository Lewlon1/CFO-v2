import { describe, it, expect } from 'vitest';
import { partitionClassifications } from './record-value-classifications';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('partitionClassifications', () => {
  it('routes a real UUID through transaction mode', () => {
    const { transactionMode, merchantMode, unrecoverable } = partitionClassifications([
      { transaction_id: UUID, value_category: 'leak' },
    ]);
    expect(transactionMode).toHaveLength(1);
    expect(merchantMode).toHaveLength(0);
    expect(unrecoverable).toHaveLength(0);
  });

  it('routes an explicit merchant_pattern through merchant mode', () => {
    const { merchantMode } = partitionClassifications([
      { merchant_pattern: 'Aldi', value_category: 'foundation' },
    ]);
    expect(merchantMode).toHaveLength(1);
    expect(merchantMode[0].merchant_pattern).toBe('Aldi');
  });

  // The test12 failure: the model put a merchant name in transaction_id (no
  // real UUID). Previously this errored ("couldn't be saved"); now it recovers
  // into a merchant rule.
  it('recovers a non-UUID transaction_id into a merchant rule', () => {
    const { transactionMode, merchantMode, unrecoverable } = partitionClassifications([
      { transaction_id: 'Claude.ai', value_category: 'investment' },
    ]);
    expect(transactionMode).toHaveLength(0);
    expect(merchantMode).toHaveLength(1);
    expect(merchantMode[0].merchant_pattern).toBe('Claude.ai');
    expect(merchantMode[0].transaction_id).toBeUndefined();
    expect(unrecoverable).toHaveLength(0);
  });

  it('flags an item with neither a usable id nor a merchant as unrecoverable', () => {
    const { merchantMode, unrecoverable } = partitionClassifications([
      { value_category: 'leak' },
    ]);
    expect(merchantMode).toHaveLength(0);
    expect(unrecoverable).toHaveLength(1);
  });

  it('handles a mixed batch', () => {
    const { transactionMode, merchantMode, unrecoverable } = partitionClassifications([
      { transaction_id: UUID, value_category: 'leak' },
      { transaction_id: 'Supabase', value_category: 'investment' },
      { merchant_pattern: 'Aldi', value_category: 'foundation' },
      { value_category: 'burden' },
    ]);
    expect(transactionMode).toHaveLength(1);
    expect(merchantMode).toHaveLength(2);
    expect(unrecoverable).toHaveLength(1);
  });
});

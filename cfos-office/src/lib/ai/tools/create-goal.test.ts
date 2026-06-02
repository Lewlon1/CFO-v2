import { describe, it, expect } from 'vitest';
import { findDuplicateActiveGoal } from './create-goal';

describe('findDuplicateActiveGoal', () => {
  // The test13-lewis case: two "Investment pot" goals were created in one
  // session. The second create should match the first and update it.
  it('matches on same type + same normalised name', () => {
    const existing = [
      { id: 'a', name: 'Investment pot', type: 'investment' },
      { id: 'b', name: 'Emergency fund', type: 'savings' },
    ];
    const match = findDuplicateActiveGoal(existing, { name: '  investment POT ', type: 'investment' });
    expect(match?.id).toBe('a');
  });

  it('does not match a different type', () => {
    const existing = [{ id: 'a', name: 'Investment pot', type: 'savings' }];
    expect(findDuplicateActiveGoal(existing, { name: 'Investment pot', type: 'investment' })).toBeUndefined();
  });

  it('does not match a different name', () => {
    const existing = [{ id: 'a', name: 'House deposit', type: 'savings' }];
    expect(findDuplicateActiveGoal(existing, { name: 'Car fund', type: 'savings' })).toBeUndefined();
  });

  it('treats a null type as "general"', () => {
    const existing = [{ id: 'a', name: 'Buffer', type: null }];
    expect(findDuplicateActiveGoal(existing, { name: 'Buffer', type: 'general' })?.id).toBe('a');
  });

  it('returns undefined for an empty list', () => {
    expect(findDuplicateActiveGoal([], { name: 'Anything', type: 'investment' })).toBeUndefined();
  });
});

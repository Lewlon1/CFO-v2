import { describe, it, expect } from 'vitest';
import { detectValueSaveHallucination } from './value-save-guard';

describe('detectValueSaveHallucination', () => {
  it('fires when the model claims a save in the review queue but did not record', () => {
    expect(
      detectValueSaveHallucination({
        assistantText: 'Saved — Aldi is now foundation.',
        lastUserText: 'Aldi is foundation',
        toolsUsed: ['get_value_review_queue'],
      }),
    ).toBe(true);
  });

  it('does NOT fire when record_value_classifications actually ran', () => {
    expect(
      detectValueSaveHallucination({
        assistantText: 'Saved across all seven merchants.',
        lastUserText: 'fast food is a leak',
        toolsUsed: ['record_value_classifications'],
      }),
    ).toBe(false);
  });

  // The test13-lewis false positive: a create_action_item sign-off mentioning
  // "done" and the goal name "Investment pot" must NOT trip the guard.
  it('does NOT fire on a create_action_item sign-off mentioning "done" and "Investment"', () => {
    expect(
      detectValueSaveHallucination({
        assistantText:
          "Action item created — linked to the Investment pot goal. Today's conversation has done its job.",
        lastUserText: 'Create an action item to set up the transfer',
        toolsUsed: ['create_action_item'],
      }),
    ).toBe(false);
  });

  it('does NOT fire when the only value words are in the assistant text (goal name), not user intent', () => {
    expect(
      detectValueSaveHallucination({
        assistantText: 'Locked in — your Investment pot is set.',
        lastUserText: 'sounds good',
        toolsUsed: ['create_goal'],
      }),
    ).toBe(false);
  });

  it('does NOT fire without a save phrase', () => {
    expect(
      detectValueSaveHallucination({
        assistantText: 'Which of these feel like a leak to you?',
        lastUserText: 'show me the leaks',
        toolsUsed: ['get_value_review_queue'],
      }),
    ).toBe(false);
  });
});

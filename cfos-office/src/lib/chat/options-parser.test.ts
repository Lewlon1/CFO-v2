import { describe, it, expect } from 'vitest';
import {
  parseOptions,
  hasOptionsBlock,
  extractChips,
  removeInvalidChips,
} from './options-parser';

describe('parseOptions — explicit [OPTIONS] block', () => {
  it('parses dash bullets', () => {
    const input = 'Here you go:\n[OPTIONS]\n- Glovo trips\n- Tesco baskets\n- Subscriptions\n[/OPTIONS]';
    const { text, options } = parseOptions(input);
    expect(options).toEqual(['Glovo trips', 'Tesco baskets', 'Subscriptions']);
    expect(text).toBe('Here you go:');
  });

  it('parses bullet bullets', () => {
    const input = 'Pick one:\n[OPTIONS]\n• one\n• two\n[/OPTIONS]';
    const { options } = parseOptions(input);
    expect(options).toEqual(['one', 'two']);
  });

  it('accepts missing closing tag', () => {
    const input = 'Want to dig in?\n[OPTIONS]\n- Drill into Glovo\n- Tighten subs';
    const { options } = parseOptions(input);
    expect(options).toEqual(['Drill into Glovo', 'Tighten subs']);
  });

  it('preserves prose around the block', () => {
    const input = 'Lead-in.\n[OPTIONS]\n- a\n- b\n[/OPTIONS]\nTrailing prose.';
    const { text, options } = parseOptions(input);
    expect(options).toEqual(['a', 'b']);
    expect(text).toContain('Lead-in.');
    expect(text).toContain('Trailing prose.');
  });
});

describe('parseOptions — trailing fallback', () => {
  it('catches a trailing list of short non-numeric items', () => {
    const input = 'Would you like to...\n- look closer at Glovo\n- check subscriptions';
    const { options } = parseOptions(input);
    expect(options).toEqual(['look closer at Glovo', 'check subscriptions']);
  });

  it('skips lists with monetary values', () => {
    const input = 'Breakdown:\n- Glovo: £400.50\n- Tesco: £220.30';
    const { options } = parseOptions(input);
    expect(options).toBeNull();
  });

  it('returns null when no block is present', () => {
    expect(parseOptions('Just prose, nothing to pick.').options).toBeNull();
  });
});

describe('hasOptionsBlock', () => {
  it('returns true when an explicit block is present', () => {
    expect(hasOptionsBlock('[OPTIONS]\n- one\n- two\n')).toBe(true);
  });

  it('returns true for a valid trailing fallback', () => {
    expect(hasOptionsBlock('Would you like to:\n- look at Glovo\n- check subs')).toBe(true);
  });

  it('returns false for plain prose', () => {
    expect(hasOptionsBlock('Just a regular message body.')).toBe(false);
  });
});

describe('extractChips', () => {
  it('returns chip strings for an explicit block', () => {
    expect(extractChips('[OPTIONS]\n- one\n- two\n[/OPTIONS]')).toEqual(['one', 'two']);
  });

  it('returns an empty array when no block exists', () => {
    expect(extractChips('plain prose')).toEqual([]);
  });
});

describe('removeInvalidChips — explicit block', () => {
  it('removes a named chip and preserves valid ones', () => {
    const input = 'Lead-in.\n[OPTIONS]\n- Tell me more\n- Drill into Glovo\n- Tighten subs\n[/OPTIONS]';
    const out = removeInvalidChips(input, ['Tell me more']);
    expect(out).toContain('Drill into Glovo');
    expect(out).toContain('Tighten subs');
    expect(out).not.toContain('Tell me more');
    // Ensures block is still there
    expect(out).toContain('[OPTIONS]');
  });

  it('case-insensitive matching', () => {
    const input = '[OPTIONS]\n- TELL ME MORE\n- Real chip\n[/OPTIONS]';
    const out = removeInvalidChips(input, ['tell me more']);
    expect(out).not.toContain('TELL ME MORE');
    expect(out).toContain('Real chip');
  });

  it('removes the whole [OPTIONS] block when all chips are invalid', () => {
    const input = 'Some prose.\n[OPTIONS]\n- Tell me more\n- Show me everything\n[/OPTIONS]';
    const out = removeInvalidChips(input, ['Tell me more', 'Show me everything']);
    expect(out).not.toContain('[OPTIONS]');
    expect(out).not.toContain('Tell me more');
    expect(out).toContain('Some prose.');
  });
});

describe('removeInvalidChips — trailing fallback', () => {
  it('removes invalid chips from a trailing block and keeps valid ones', () => {
    const input = 'Anything to dig into?\n- Tell me more\n- Drill into Glovo';
    const out = removeInvalidChips(input, ['Tell me more']);
    expect(out).not.toContain('Tell me more');
    expect(out).toContain('Drill into Glovo');
  });

  it('drops the whole trailing block when empty', () => {
    const input = 'Anything to dig into?\n- Tell me more\n- Let me know';
    const out = removeInvalidChips(input, ['Tell me more', 'Let me know']);
    expect(out).not.toContain('Tell me more');
    expect(out).not.toContain('Let me know');
    expect(out.trim()).toBe('Anything to dig into?');
  });
});

describe('removeInvalidChips — no-op cases', () => {
  it('returns unchanged text when invalid list is empty', () => {
    const input = '[OPTIONS]\n- one\n- two\n[/OPTIONS]';
    expect(removeInvalidChips(input, [])).toBe(input);
  });

  it('returns unchanged text when no block is present', () => {
    expect(removeInvalidChips('plain prose', ['anything'])).toBe('plain prose');
  });
});

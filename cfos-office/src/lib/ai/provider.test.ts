import { describe, it, expect, afterEach } from 'vitest';
import { assertEuBedrockModel } from './provider';

const ORIGINAL_ALLOW = process.env.ALLOW_NON_EU_BEDROCK;

afterEach(() => {
  process.env.ALLOW_NON_EU_BEDROCK = ORIGINAL_ALLOW;
});

describe('assertEuBedrockModel (Rule 5 — EU or nothing)', () => {
  it('passes through an eu.-prefixed model id unchanged', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    expect(assertEuBedrockModel('eu.anthropic.claude-sonnet-4-6', 'chat model')).toBe(
      'eu.anthropic.claude-sonnet-4-6',
    );
  });

  it('throws for a global inference profile', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    expect(() =>
      assertEuBedrockModel('global.anthropic.claude-sonnet-4-6', 'chat model'),
    ).toThrow(/Rule 5/);
  });

  it('throws for a US-region inference profile', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    expect(() => assertEuBedrockModel('us.anthropic.claude-sonnet-4-6', 'compose model')).toThrow(
      /non-EU/,
    );
  });

  it('allows a non-EU model only when ALLOW_NON_EU_BEDROCK=1 is explicitly set', () => {
    process.env.ALLOW_NON_EU_BEDROCK = '1';
    expect(assertEuBedrockModel('global.anthropic.claude-sonnet-4-6', 'chat model')).toBe(
      'global.anthropic.claude-sonnet-4-6',
    );
  });

  it('does not treat any other value as the escape hatch', () => {
    process.env.ALLOW_NON_EU_BEDROCK = 'true';
    expect(() =>
      assertEuBedrockModel('global.anthropic.claude-sonnet-4-6', 'chat model'),
    ).toThrow(/Rule 5/);
  });
});

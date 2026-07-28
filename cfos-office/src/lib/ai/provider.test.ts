import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertEuBedrockModel, resolveEuModel } from './provider';

const ORIGINAL_ALLOW = process.env.ALLOW_NON_EU_BEDROCK;
const ORIGINAL_PHASE = process.env.NEXT_PHASE;

afterEach(() => {
  process.env.ALLOW_NON_EU_BEDROCK = ORIGINAL_ALLOW;
  if (ORIGINAL_PHASE === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = ORIGINAL_PHASE;
  vi.restoreAllMocks();
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

describe('resolveEuModel (build phase vs runtime)', () => {
  it('throws at runtime (no NEXT_PHASE) for a non-EU model', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    delete process.env.NEXT_PHASE;
    expect(() =>
      resolveEuModel('global.anthropic.claude-sonnet-4-6', 'eu.fallback', 'chat model'),
    ).toThrow(/Rule 5/);
  });

  it('logs instead of throwing during next build page-data collection', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    process.env.NEXT_PHASE = 'phase-production-build';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveEuModel('global.anthropic.claude-sonnet-4-6', 'eu.fallback', 'chat model')).toBe(
      'global.anthropic.claude-sonnet-4-6',
    );
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/Rule 5 warning/);
  });

  it('stays quiet during build for an eu. model', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    process.env.NEXT_PHASE = 'phase-production-build';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveEuModel(undefined, 'eu.anthropic.claude-sonnet-4-6', 'chat model')).toBe(
      'eu.anthropic.claude-sonnet-4-6',
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still throws for a non-EU model when NEXT_PHASE is the production server', () => {
    delete process.env.ALLOW_NON_EU_BEDROCK;
    process.env.NEXT_PHASE = 'phase-production-server';
    expect(() =>
      resolveEuModel('us.anthropic.claude-sonnet-4-6', 'eu.fallback', 'compose model'),
    ).toThrow(/non-EU/);
  });
});

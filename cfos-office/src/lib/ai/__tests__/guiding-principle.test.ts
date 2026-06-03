import { describe, it, expect } from 'vitest';
import type { ToolContext } from '../tools/types';
import { BASE_PERSONA } from '../system-prompt';
import { createProposeCatalogExperimentTool } from '../tools/propose-catalog-experiment';

// Prompt-CONTENT assertions: they lock the principle-over-procedure changes
// without needing the live model. Behavioural quality (does it actually coach
// well?) is verified by human review against CFO-CONSTITUTION §6 — see SESSION-LOG.

describe('guiding principle in BASE_PERSONA', () => {
  it('carries the How-you-guide section and its load-bearing rules', () => {
    expect(BASE_PERSONA).toContain('## How you guide');
    expect(BASE_PERSONA).toContain('One topic per turn');
    expect(BASE_PERSONA).toContain('Tie every move to the goal');
    expect(BASE_PERSONA).toContain('Mechanism matches the claim');
    expect(BASE_PERSONA).toContain('The move, not the machinery');
  });

  it('relaxes the forced menu but keeps the good pacing (one-per-turn, active-first)', () => {
    expect(BASE_PERSONA).not.toContain('ALWAYS follow with an [OPTIONS]');
    expect(BASE_PERSONA).toContain('at most one per turn');
    expect(BASE_PERSONA).toContain('if one is already running');
    expect(BASE_PERSONA).toContain('not required');
  });

  it('reconciles the D4 system-voice contradiction', () => {
    // The old GOOD example named the plumbing — now demoted to BAD.
    expect(BASE_PERSONA).not.toContain('"The system has these in the Leak bucket — worth a sanity check."');
    expect(BASE_PERSONA).toContain('auto-sorted into Leak');
  });

  it("keeps 'experiment' as an allowed plain word, bans the compound jargon", () => {
    expect(BASE_PERSONA).toContain('call it an "experiment"');
    expect(BASE_PERSONA).toContain('"friction experiment"');
    expect(BASE_PERSONA).toContain('jargon');
  });
});

describe('propose_catalog_experiment description', () => {
  const ctx = { supabase: {}, userId: 'u', conversationId: 'c', currency: 'EUR' } as unknown as ToolContext;
  const tool = createProposeCatalogExperimentTool(ctx);

  it('drops the forced [OPTIONS] mandate and requires mechanism-matches-claim', () => {
    expect(tool.description).not.toContain('Always immediately follow with the OPTIONS block');
    expect(tool.description).toContain('not required');
    expect(tool.description).toContain("template's own hypothesis");
    expect(tool.description).toContain('mismatched claim');
  });
});

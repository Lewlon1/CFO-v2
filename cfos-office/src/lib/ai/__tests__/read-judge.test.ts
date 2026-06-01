import { describe, it, expect } from 'vitest';
import {
  checkReadHardRules,
  predictWowScore,
  READ_WORD_CAP,
  READ_JUDGE_ID,
} from '@/lib/ai/read-judge';

// A compliant value-first Read: leads with Layer-1 facts, ≤250 words, cites a
// real merchant, closes on the Value Map CTA, signs off "— C.".
const GOOD_VALUE_FIRST = `You're bringing in 3,200 a month with 1,400 going to fixed costs, which leaves 1,800 to work with. Your deposit goal sits comfortably against that.

**Glovo** has been climbing — up 18%/mo over the window. I can see it happening but I can't read whether it's a Foundation you rely on or a Leak worth trimming without you.

[CTA:start_value_map_real]Tell me what these mean[/CTA]
— C.`;

const ruleMap = (rules: ReturnType<typeof checkReadHardRules>) =>
  Object.fromEntries(rules.map((r) => [r.ruleId, r.passed]));

describe('checkReadHardRules — current Read contract', () => {
  it('passes a compliant value-first Read', () => {
    const rules = ruleMap(
      checkReadHardRules(GOOD_VALUE_FIRST, { mode: 'value_first', knownMerchants: ['glovo'] }),
    );
    expect(rules.H1_signoff_present).toBe(true);
    expect(rules.H2_within_word_cap).toBe(true);
    expect(rules.H3_exactly_one_cta).toBe(true);
    expect(rules.H3b_value_first_cta_type).toBe(true);
    expect(rules.H4_no_options_block).toBe(true);
    expect(rules.H5_no_question_close).toBe(true);
    expect(rules.H6_no_emoji).toBe(true);
    expect(rules.H7_voice_no_banned).toBe(true);
    expect(rules.H8_cites_known_merchant).toBe(true);
  });

  it('fails when the signoff is missing', () => {
    const rules = ruleMap(checkReadHardRules(GOOD_VALUE_FIRST.replace('\n— C.', '')));
    expect(rules.H1_signoff_present).toBe(false);
  });

  it('flags the retired [OPTIONS] chip block', () => {
    const withOptions = `Something specific about **Glovo**.\n[OPTIONS]\n- Drill into Glovo\n[/OPTIONS]\n— C.`;
    const rules = ruleMap(checkReadHardRules(withOptions));
    expect(rules.H4_no_options_block).toBe(false);
  });

  it('flags a close that ends on a question (retired format allowed this)', () => {
    const questionClose = `Your dining is climbing. Does that sound right to you?\n[CTA:cut_lever]Trim 40[/CTA]\n— C.`;
    // The CTA + signoff are stripped, so the last prose sentence is the question.
    const rules = ruleMap(checkReadHardRules(questionClose));
    expect(rules.H5_no_question_close).toBe(false);
  });

  it('flags more than one CTA', () => {
    const twoCtas = `Body.\n[CTA:cut_lever]Trim 40[/CTA]\n[CTA:supply_input]Add income[/CTA]\n— C.`;
    const rules = ruleMap(checkReadHardRules(twoCtas));
    expect(rules.H3_exactly_one_cta).toBe(false);
  });

  it('flags a value-first Read closing on the wrong CTA type', () => {
    const wrongCta = GOOD_VALUE_FIRST.replace('start_value_map_real', 'cut_lever');
    const rules = ruleMap(checkReadHardRules(wrongCta, { mode: 'value_first' }));
    expect(rules.H3b_value_first_cta_type).toBe(false);
  });

  it('enforces the 250-word cap (not the retired 180)', () => {
    expect(READ_WORD_CAP).toBe(250);
    const body = Array.from({ length: 200 }, () => 'word').join(' ');
    const at200 = `${body}\n[CTA:cut_lever]Trim[/CTA]\n— C.`;
    expect(ruleMap(checkReadHardRules(at200)).H2_within_word_cap).toBe(true);
    const over = `${Array.from({ length: 260 }, () => 'word').join(' ')}\n— C.`;
    expect(ruleMap(checkReadHardRules(over)).H2_within_word_cap).toBe(false);
  });

  it('flags banned reflexive-CFO phrases via the shared prod validator', () => {
    const banned = `Here is some advice about **Glovo**.\n[CTA:cut_lever]Trim[/CTA]\n— C.`;
    expect(ruleMap(checkReadHardRules(banned)).H7_voice_no_banned).toBe(false);
  });

  it('flags emoji', () => {
    const emoji = `Nice work 🎉 on **Glovo**.\n[CTA:cut_lever]Trim[/CTA]\n— C.`;
    expect(ruleMap(checkReadHardRules(emoji)).H6_no_emoji).toBe(false);
  });

  it('fails the merchant check when no known merchant is cited', () => {
    const rules = ruleMap(checkReadHardRules(GOOD_VALUE_FIRST, { knownMerchants: ['netflix'] }));
    expect(rules.H8_cites_known_merchant).toBe(false);
  });

  it('omits the merchant rule when no merchant universe is provided', () => {
    const ids = checkReadHardRules(GOOD_VALUE_FIRST).map((r) => r.ruleId);
    expect(ids).not.toContain('H8_cites_known_merchant');
  });
});

describe('predictWowScore — deterministic cron score', () => {
  it('stamps the traceable judge id', () => {
    expect(predictWowScore(GOOD_VALUE_FIRST).judgeId).toBe(READ_JUDGE_ID);
  });

  it('scores a compliant + rich Read higher than a compliant + thin one', () => {
    const rich = predictWowScore(GOOD_VALUE_FIRST, {
      mode: 'value_first',
      layersUsed: ['L1', 'L2', 'L3', 'L5'],
      featuresCited: ['trend', 'recurrence', 'time_pattern'],
      gapPresent: true,
      clustersReferenced: ['glovo', 'spotify'],
    });
    const thin = predictWowScore(GOOD_VALUE_FIRST, {
      mode: 'value_first',
      layersUsed: ['L1', 'L2', 'L3'],
      featuresCited: [],
      gapPresent: false,
      clustersReferenced: [],
    });
    expect(rich.score).toBeGreaterThan(thin.score);
    expect(rich.score).toBeLessThanOrEqual(1);
    expect(thin.score).toBeGreaterThanOrEqual(0);
  });

  it('penalises a malformed Read (no signoff, has [OPTIONS]) below a clean one', () => {
    const malformed = `Generic summary with no merchant.\n[OPTIONS]\n- x\n[/OPTIONS]`;
    const clean = predictWowScore(GOOD_VALUE_FIRST, { mode: 'value_first' });
    expect(predictWowScore(malformed).score).toBeLessThan(clean.score);
  });

  it('returns a value rounded to 3 decimal places', () => {
    const { score } = predictWowScore(GOOD_VALUE_FIRST, { featuresCited: ['trend'] });
    expect(score).toBe(Math.round(score * 1000) / 1000);
  });
});

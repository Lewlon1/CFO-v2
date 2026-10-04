import { describe, it, expect } from 'vitest';

import {
  MAX_REPORT_LENGTH,
  buildReportPayload,
  isSendableReport,
} from './feedback-contract';

// The cap is duplicated in three places by necessity — the textarea's maxLength,
// the route's zod schema, and migration 083's check constraint. This suite is
// what stops them drifting: the constant is the one both TS consumers import,
// and the number below is the one written into the DB constraint.
describe('MAX_REPORT_LENGTH', () => {
  it('matches the char_length check in migration 083', () => {
    expect(MAX_REPORT_LENGTH).toBe(2000);
  });
});

describe('buildReportPayload', () => {
  it('maps the args to the route contract verbatim', () => {
    expect(buildReportPayload('msg-1', 'conv-1', 'the £340 dining figure is wrong')).toEqual({
      first_read_message_id: 'msg-1',
      conversation_id: 'conv-1',
      body: 'the £340 dining figure is wrong',
    });
  });

  it('trims the body, so the route never sees padding the user did not mean', () => {
    expect(buildReportPayload('msg-1', 'conv-1', '  rent is not £1,200  ').body).toBe(
      'rent is not £1,200',
    );
  });
});

describe('isSendableReport', () => {
  it('rejects an empty draft', () => {
    expect(isSendableReport('')).toBe(false);
  });

  it('rejects whitespace-only — that is not a report', () => {
    expect(isSendableReport('   \n\t ')).toBe(false);
  });

  it('accepts a single character', () => {
    expect(isSendableReport('x')).toBe(true);
  });

  it('accepts a draft exactly at the cap', () => {
    expect(isSendableReport('x'.repeat(MAX_REPORT_LENGTH))).toBe(true);
  });

  it('rejects a draft over the cap, matching the route rather than letting it 400', () => {
    expect(isSendableReport('x'.repeat(MAX_REPORT_LENGTH + 1))).toBe(false);
  });

  it('measures the trimmed length, so trailing whitespace cannot push it over', () => {
    expect(isSendableReport(`${'x'.repeat(MAX_REPORT_LENGTH)}    `)).toBe(true);
  });
});

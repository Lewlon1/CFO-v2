import { describe, it, expect, afterEach } from 'vitest';
import { showInternalQANotes } from './qa-notes';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_FLAG = process.env.SHOW_QA_NOTES;

afterEach(() => {
  // vitest typing marks NODE_ENV readonly; assign through the record.
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.SHOW_QA_NOTES = ORIGINAL_FLAG;
});

describe('showInternalQANotes', () => {
  it('suppresses notes in production', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.SHOW_QA_NOTES;
    expect(showInternalQANotes()).toBe(false);
  });

  it('shows notes outside production (dev/staging/test)', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.SHOW_QA_NOTES;
    expect(showInternalQANotes()).toBe(true);
  });

  it('forces notes on in production when SHOW_QA_NOTES=true', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SHOW_QA_NOTES = 'true';
    expect(showInternalQANotes()).toBe(true);
  });
});

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
  it('suppresses notes by default in production', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.SHOW_QA_NOTES;
    expect(showInternalQANotes()).toBe(false);
  });

  // Regression: notes previously showed in any non-production env, which leaked
  // the "(System note: …)" diagnostic to real testers on staging (NODE_ENV
  // !== 'production'). Default is now off everywhere unless explicitly forced.
  it('suppresses notes by default outside production (incl. staging)', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.SHOW_QA_NOTES;
    expect(showInternalQANotes()).toBe(false);
  });

  it('shows notes only when explicitly forced via SHOW_QA_NOTES=true', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SHOW_QA_NOTES = 'true';
    expect(showInternalQANotes()).toBe(true);
  });
});

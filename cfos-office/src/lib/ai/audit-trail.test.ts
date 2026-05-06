import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { extractMessageAudit } from './audit-trail';

// The runtime parser only reads `parts[].type`, `parts[].state`,
// `parts[].output` — cast through unknown so the fixture builder doesn't
// have to satisfy the full discriminated UIMessage union.
function assistantMsg(parts: Array<Record<string, unknown>>): UIMessage {
  return { id: 'm1', role: 'assistant', parts } as unknown as UIMessage;
}

describe('extractMessageAudit', () => {
  it('returns empty arrays when no messages', () => {
    const result = extractMessageAudit([]);
    expect(result.toolsUsed).toEqual([]);
    expect(result.profileUpdates).toEqual([]);
    expect(result.actionsCreated).toEqual([]);
    expect(result.insightsGenerated).toEqual([]);
  });

  it('returns empty arrays when message has only text parts', () => {
    const result = extractMessageAudit([
      assistantMsg([{ type: 'text', text: 'hello' }]),
    ]);
    expect(result.toolsUsed).toEqual([]);
    expect(result.insightsGenerated).toEqual([]);
  });

  it('captures tool name in toolsUsed when state is output-available', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-get_spending_summary',
          state: 'output-available',
          toolCallId: 'c1',
          output: { total: 1234, currency: 'EUR' },
        },
      ]),
    ]);
    expect(result.toolsUsed).toEqual(['get_spending_summary']);
  });

  it('does NOT capture tools whose state is input-streaming or input-available', () => {
    const result = extractMessageAudit([
      assistantMsg([
        { type: 'tool-get_spending_summary', state: 'input-streaming', toolCallId: 'c1' },
        { type: 'tool-compare_months', state: 'input-available', toolCallId: 'c2' },
      ]),
    ]);
    expect(result.toolsUsed).toEqual([]);
  });

  it('does NOT capture tools whose state is output-error', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-create_action_item',
          state: 'output-error',
          toolCallId: 'c1',
          errorText: 'boom',
        },
      ]),
    ]);
    expect(result.toolsUsed).toEqual([]);
    expect(result.actionsCreated).toEqual([]);
  });

  it('deduplicates the same tool fired multiple times in toolsUsed', () => {
    const result = extractMessageAudit([
      assistantMsg([
        { type: 'tool-get_spending_summary', state: 'output-available', toolCallId: 'c1', output: { rows: 1 } },
        { type: 'tool-get_spending_summary', state: 'output-available', toolCallId: 'c2', output: { rows: 2 } },
      ]),
    ]);
    expect(result.toolsUsed).toEqual(['get_spending_summary']);
  });

  it('populates profileUpdates from update_user_profile saved array', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-update_user_profile',
          state: 'output-available',
          toolCallId: 'c1',
          output: {
            saved: ['gross_salary', 'monthly_rent'],
            skipped: [],
            source: 'user mentioned salary',
            before_values: {},
            saved_values: { gross_salary: 50000, monthly_rent: 1200 },
          },
        },
      ]),
    ]);
    expect(result.profileUpdates).toEqual([
      { field: 'gross_salary' },
      { field: 'monthly_rent' },
    ]);
  });

  it('populates actionsCreated from create_action_item success output', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-create_action_item',
          state: 'output-available',
          toolCallId: 'c1',
          output: {
            success: true,
            action_item: {
              id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
              title: 'Switch electricity provider',
              category: 'bill_switch',
              priority: 'medium',
              due_date: null,
            },
            message: 'Action item "Switch electricity provider" created.',
          },
        },
      ]),
    ]);
    expect(result.actionsCreated).toEqual([
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        title: 'Switch electricity provider',
      },
    ]);
  });

  it('populates insightsGenerated for every successful structured-output tool', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-analyse_gap',
          state: 'output-available',
          toolCallId: 'c1',
          output: { discrepancies: [{ category: 'gym', expected: 'investment', actual: 'leak' }] },
        },
        {
          type: 'tool-get_spending_summary',
          state: 'output-available',
          toolCallId: 'c2',
          output: { total: 1234, currency: 'EUR' },
        },
      ]),
    ]);
    expect(result.insightsGenerated).toHaveLength(2);
    expect(result.insightsGenerated[0]).toEqual({
      tool: 'analyse_gap',
      output: { discrepancies: [{ category: 'gym', expected: 'investment', actual: 'leak' }] },
    });
    expect(result.insightsGenerated[1].tool).toBe('get_spending_summary');
  });

  it('excludes tools that returned an error object from insightsGenerated', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-create_action_item',
          state: 'output-available',
          toolCallId: 'c1',
          output: { error: 'Could not create the action item.' },
        },
      ]),
    ]);
    expect(result.toolsUsed).toEqual(['create_action_item']);
    expect(result.actionsCreated).toEqual([]);
    expect(result.insightsGenerated).toEqual([]);
  });

  it('excludes request_structured_input from insightsGenerated (UI directive, not an insight)', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-request_structured_input',
          state: 'output-available',
          toolCallId: 'c1',
          output: {
            type: 'structured_input',
            field: 'gross_salary',
            input_type: 'currency_amount',
            label: "What's your annual salary?",
            rationale: 'helps tax planning',
          },
        },
      ]),
    ]);
    expect(result.toolsUsed).toEqual(['request_structured_input']);
    expect(result.insightsGenerated).toEqual([]);
  });

  it('handles a mixed-tool turn with multiple events captured in one pass', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-update_user_profile',
          state: 'output-available',
          toolCallId: 'c1',
          output: {
            saved: ['relationship_status'],
            skipped: [],
            source: 'said partnered',
            before_values: {},
            saved_values: {},
          },
        },
        {
          type: 'tool-create_action_item',
          state: 'output-available',
          toolCallId: 'c2',
          output: {
            success: true,
            action_item: {
              id: 'id-1',
              title: 'Set up joint budget',
              category: 'admin',
              priority: 'medium',
              due_date: null,
            },
            message: 'ok',
          },
        },
        {
          type: 'tool-get_spending_summary',
          state: 'output-available',
          toolCallId: 'c3',
          output: { total: 500, currency: 'EUR' },
        },
      ]),
    ]);
    expect([...result.toolsUsed].sort()).toEqual(
      ['create_action_item', 'get_spending_summary', 'update_user_profile'].sort(),
    );
    expect(result.profileUpdates).toEqual([{ field: 'relationship_status' }]);
    expect(result.actionsCreated).toEqual([{ id: 'id-1', title: 'Set up joint budget' }]);
    // All three count as insights (none are NON_INSIGHT_TOOLS, all returned
    // structured non-error output).
    expect(result.insightsGenerated).toHaveLength(3);
  });

  it('walks parts across multiple messages (assistant + tool messages from multi-step turns)', () => {
    const result = extractMessageAudit([
      assistantMsg([
        {
          type: 'tool-get_spending_summary',
          state: 'output-available',
          toolCallId: 'c1',
          output: { total: 100 },
        },
      ]),
      assistantMsg([
        {
          type: 'tool-create_action_item',
          state: 'output-available',
          toolCallId: 'c2',
          output: {
            success: true,
            action_item: { id: 'id-2', title: 'Save more' },
          },
        },
      ]),
    ]);
    expect([...result.toolsUsed].sort()).toEqual(
      ['create_action_item', 'get_spending_summary'].sort(),
    );
    expect(result.actionsCreated).toHaveLength(1);
  });
});

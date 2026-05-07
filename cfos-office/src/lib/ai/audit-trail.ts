import type { UIMessage } from 'ai';

export type MessageAudit = {
  toolsUsed: string[];
  profileUpdates: Array<{ field: string }>;
  actionsCreated: Array<{ id: string; title: string }>;
  insightsGenerated: Array<{ tool: string; output: unknown }>;
};

// Tool whose output is a UI directive (component config), not an analytical
// insight. Excluded from `insights_generated` to keep the column meaningful.
const NON_INSIGHT_TOOLS = new Set(['request_structured_input']);

type ToolOutputPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  output?: unknown;
};

function isToolPart(part: { type?: string }): part is ToolOutputPart {
  return typeof part.type === 'string' && part.type.startsWith('tool-');
}

function isStructuredOutput(out: unknown): out is Record<string, unknown> {
  return out !== null && typeof out === 'object' && !Array.isArray(out);
}

export function extractMessageAudit(responseMessages: UIMessage[]): MessageAudit {
  const toolsUsed: string[] = [];
  const profileUpdates: Array<{ field: string }> = [];
  const actionsCreated: Array<{ id: string; title: string }> = [];
  const insightsGenerated: Array<{ tool: string; output: unknown }> = [];

  for (const msg of responseMessages) {
    if (!msg.parts) continue;
    for (const part of msg.parts) {
      if (!isToolPart(part)) continue;
      // Only count tools that produced a result. 'input-streaming',
      // 'input-available', and 'output-error' do not count as a completed,
      // successful tool call.
      if (part.state !== 'output-available') continue;

      const toolName = part.type.slice('tool-'.length);
      if (!toolName) continue;
      if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);

      const out = part.output;

      if (
        toolName === 'create_action_item' &&
        isStructuredOutput(out) &&
        out.success === true &&
        isStructuredOutput(out.action_item)
      ) {
        const ai = out.action_item;
        if (typeof ai.id === 'string' && typeof ai.title === 'string') {
          actionsCreated.push({ id: ai.id, title: ai.title });
        }
      }

      if (
        toolName === 'update_user_profile' &&
        isStructuredOutput(out) &&
        Array.isArray(out.saved)
      ) {
        for (const field of out.saved) {
          if (typeof field === 'string') profileUpdates.push({ field });
        }
      }

      // Broad capture: every successful structured-output tool counts as
      // producing an insight, except UI-directive tools and tools that
      // returned an explicit error.
      if (
        !NON_INSIGHT_TOOLS.has(toolName) &&
        isStructuredOutput(out) &&
        !('error' in out)
      ) {
        insightsGenerated.push({ tool: toolName, output: out });
      }
    }
  }

  return { toolsUsed, profileUpdates, actionsCreated, insightsGenerated };
}

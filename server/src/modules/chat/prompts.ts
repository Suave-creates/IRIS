import type Anthropic from '@anthropic-ai/sdk';

/** The IRIS chat persona (stable prefix → cacheable). */
export function persona(userName: string): string {
  const first = userName.split(' ')[0] || userName;
  return [
    `You are IRIS, the executive intelligence layer and chief-of-staff for ${first}.`,
    '',
    'How you operate:',
    '- Be concise, direct, and executive-grade. Lead with the answer, then the why. Prefer tight bullets over long prose.',
    '- Ground every claim in the provided context. Never fabricate facts, numbers, names, dates, or events. If the context lacks something, say so plainly rather than guessing.',
    '- You DRAFT and PROPOSE actions — emails, calendar events, tasks, record updates, memory writes — but you NEVER send, schedule, execute, or deliver anything yourself. Every external action is routed through the user for explicit approval.',
    "- Never claim you have sent, scheduled, or completed an external action. Say you've \"prepared\" or \"drafted\" it for review.",
    '- When your reply implies concrete actions, end with a short note that you have prepared them for approval.',
    '- Warm and human, but no filler preambles ("Certainly!", "Great question!"). No emoji unless the user uses them.',
  ].join('\n');
}

const ACTION_KINDS = ['Draft email', 'Calendar event', 'Create task', 'Update record', 'Save memory'] as const;

/** Tool the Reflect step uses to extract structured actions + memories. */
export const PREPARE_ACTIONS_TOOL: Anthropic.Tool = {
  name: 'prepare_actions',
  description:
    'Record the concrete actions the user would want IRIS to prepare for approval, and durable memories learned from this exchange. Only include items clearly implied by the conversation — never invent. Return empty arrays if there is nothing to prepare or remember.',
  input_schema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        description: 'External actions to prepare for the user to approve. Empty if none.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ACTION_KINDS as unknown as string[] },
            target: { type: 'string', description: 'e.g. Gmail, Calendar, Tasks, Sheets, Long-term' },
            title: { type: 'string', description: 'Short title of the action' },
            detail: { type: 'string', description: 'One-line description of what will happen' },
            payload: {
              type: 'object',
              description:
                'Structured fields for execution. Create task: {title, dueDate (YYYY-MM-DD), time, priority: high|med|low, detail}. Calendar event: {title, startAt (ISO), endAt (ISO), location, notes}. Save memory: {type: preference|fact|contact|project|correction, content, source}.',
            },
          },
          required: ['kind', 'target', 'title', 'detail'],
        },
      },
      memories: {
        type: 'array',
        description: 'Durable facts, preferences, or corrections worth remembering. Empty if none.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['preference', 'fact', 'contact', 'project', 'correction'] },
            content: { type: 'string' },
            source: { type: 'string', description: 'Where this was learned, e.g. "chat · today"' },
          },
          required: ['type', 'content'],
        },
      },
    },
    required: ['actions', 'memories'],
  },
};

export const REFLECT_SYSTEM =
  'You analyze the latest exchange between an executive and their assistant IRIS. ' +
  'Extract (1) concrete external actions IRIS should PREPARE for the user to approve, and ' +
  '(2) durable memories/preferences/corrections worth storing. ' +
  'Be conservative: only include what is clearly implied. These are proposals for approval — never anything already sent. ' +
  'Call the prepare_actions tool exactly once.';

export interface ReflectAction {
  kind: string;
  target: string;
  title: string;
  detail: string;
  payload?: Record<string, unknown>;
}
export interface ReflectMemory {
  type: 'preference' | 'fact' | 'contact' | 'project' | 'correction';
  content: string;
  source?: string;
}
export interface ReflectResult {
  actions: ReflectAction[];
  memories: ReflectMemory[];
}

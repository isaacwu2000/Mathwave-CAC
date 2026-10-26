import {
  panelCommand,
  parseHistoryCommand,
  runCommand,
  validateInterpretation,
  type HistoryContext,
} from '../../commands/index.ts';
import { explorationView, validatePresentation } from '../../visuals/index.ts';
import type { Workspace } from '../../workspace/state.ts';
import { presentationSchema } from '../config/exploration-schema.ts';
export const previewTools = [
  {
    type: 'function',
    name: 'preview_math',
    description:
      'Validate and simulate a restricted TypeScript math program or ordered programs batch on a copy of the current workspace. Returns the resulting workspace and engine readbacks, or a validation error. Never applies or saves anything. Do not include history, audio or panel controls.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['program', 'programs'],
      properties: {
        program: { type: 'string', maxLength: 1800 },
        programs: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 1800 },
          maxItems: 6,
        },
      },
    },
  },
  {
    type: 'function',
    name: 'preview_explanation',
    description:
      'Validate an interactive explanation and inspect the actual calculated readouts and graph expressions. Returns validation errors for repair. Never changes homework.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['presentation'],
      properties: {
        presentation: presentationSchema,
      },
    },
  },
];

/** All previews are deterministic, read-only observations for the agent. */
export function previewTool(
  name: string | undefined,
  argumentsText: string | undefined,
  state: Workspace,
  history?: HistoryContext,
): unknown {
  try {
    const args = JSON.parse(argumentsText || '{}');
    if (name === 'preview_math') {
      const plan = validateInterpretation(
        {
          status: 'command',
          command: '',
          message: '',
          commands: args.commands,
          program: args.program,
          programs: args.programs,
        },
        state,
        history,
      );
      const commands = plan.commands?.length
        ? plan.commands
        : plan.command
          ? [plan.command]
          : [];
      if (!commands.length) throw new Error('Provide a math program.');
      let preview = structuredClone(state);
      const messages = [];
      for (const command of commands) {
        if (panelCommand(command) || parseHistoryCommand(command, history))
          throw new Error('Previews cannot execute controls.');
        const r = runCommand(preview, command);
        if (r.action) throw new Error('Previews cannot execute controls.');
        preview = r.state;
        messages.push(r.message);
      }
      return { workspace: preview, messages, applied: false };
    }
    if (name === 'preview_explanation') {
      const presentation = validatePresentation(args.presentation);
      if (presentation?.action !== 'show')
        throw new Error('Provide an explanation to show.');
      return { view: explorationView(presentation.content), applied: false };
    }
    throw new Error('Unknown preview tool.');
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid preview.',
      applied: false,
    };
  }
}

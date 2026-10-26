import {
  isMathProgramCommand,
  isStoredCommandGroup,
  runCommand,
  storedCommands,
  validateInterpretation,
} from '../../commands/index.ts';
import { historyContext } from './history-commands.ts';
import {
  contentChanged,
  currentProblem,
  recordPlan,
  type ProblemLibrary,
} from './problem-library.ts';

/** Splits only explicit sequencing words; mathematical conjunctions stay intact. */
export function splitMathPlan(text: string): string[] | null {
  if (isStoredCommandGroup(text)) return storedCommands(text);
  if (isMathProgramCommand(text)) return null;
  const parts = text.split(/\s+(?:and\s+)?then\s+|;\s*/i).map((s) => s.trim());
  if (parts.length < 2) return null;
  if (parts.length > 6 || parts.some((s) => !s))
    throw new Error('Use up to six complete operations in one request.');
  return parts;
}
export function applyMathPlan(book: ProblemLibrary, commands: string[]) {
  let state = currentProblem(book).state;
  validateInterpretation(
    { status: 'command', command: '', commands, message: '' },
    state,
    historyContext(book),
  );
  const changes = [],
    messages = [],
    queryMessages = [];
  for (const command of commands) {
    const result = runCommand(state, command);
    if (result.written || contentChanged(state, result.state))
      changes.push({
        command: result.storedCommand || command,
        displayCommand: command,
        state: result.state,
      });
    if (result.written || contentChanged(state, result.state))
      queryMessages.length = 0;
    messages.push(result.message);
    if (!result.written && !contentChanged(state, result.state))
      queryMessages.push(result.message);
    state = result.state;
  }
  const next = recordPlan(book, changes, state);
  return {
    book: next,
    state,
    message: changes.length
      ? `${changes.length} ${changes.length === 1 ? 'step' : 'steps'} saved. ${queryMessages.length ? queryMessages.filter(Boolean).join('\n') : messages.at(-1) || ''}`
      : messages.filter(Boolean).join('\n'),
    stepsAdded: changes.length,
  };
}

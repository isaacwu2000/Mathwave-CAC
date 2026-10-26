import { runCommand } from '../../Web/src/modules/commands/index.ts';
import { type Workspace } from '../../Web/src/modules/workspace/state.ts';
import type { ClarificationContext } from '../../Web/src/modules/commands/index.ts';
import { validateInterpretation, type Interpretation } from '../../Web/src/modules/commands/index.ts';
export type Case = {
  id: string;
  family: string;
  category: string;
  utterance: string;
  state: Workspace;
  clarification?: ClarificationContext;
  expected: {
    status: Interpretation['status'];
    command?: string;
    messagePattern?: string;
  };
};
export function grade(
  item: Case,
  prediction: Interpretation,
  source: 'agent' | 'parser' = 'agent',
) {
  const before = JSON.stringify(item.state);
  try {
    const actual =
      source === 'parser'
        ? prediction
        : validateInterpretation(
            prediction,
            structuredClone(item.state),
            undefined,
            item.clarification ? undefined : item.utterance,
          );
    if (actual.status !== item.expected.status)
      return {
        pass: false,
        reason: `Expected ${item.expected.status}, received ${actual.status}`,
      };
    if (actual.status !== 'command') {
      if (actual.command.trim())
        return {
          pass: false,
          reason: 'Non-command response contains an executable command',
        };
      const pass =
        !item.expected.messagePattern ||
        new RegExp(item.expected.messagePattern, 'i').test(actual.message);
      return {
        pass,
        reason: pass
          ? 'Correct abstention'
          : 'Clarification did not identify the missing information',
      };
    }
    const expected = runCommand(
      structuredClone(item.state),
      item.expected.command!,
    );
    let next = structuredClone(item.state);
    let changed = false;
    const commands = actual.commands?.length
      ? actual.commands
      : [actual.command];
    const answers: string[] = [];
    let result: ReturnType<typeof runCommand> | undefined;
    for (const command of commands) {
      result = runCommand(next, command);
      if (result.changed || result.written) {
        changed = true;
        answers.length = 0;
      }
      answers.push(result.message);
      next = result.state;
    }
    if (!result) throw new Error('Empty interpretation');
    result = { ...result, state: next, changed, message: answers.join('\n') };
    const sameState =
      JSON.stringify(result.state) === JSON.stringify(expected.state);
    const sameAction = result.action === expected.action;
    // Read-only operations can have identical states but different answers.
    const normalize = (message: string) =>
      message.replace(/\baverage\b/gi, 'Mean');
    const sameAnswer =
      result.changed ||
      normalize(result.message) === normalize(expected.message);
    const numericOracle =
      !item.expected.messagePattern ||
      new RegExp(item.expected.messagePattern, 'i').test(result.message);
    const pass =
      sameState &&
      sameAction &&
      sameAnswer &&
      numericOracle &&
      before === JSON.stringify(item.state);
    return {
      pass,
      reason: pass
        ? 'Correct behavior'
        : 'Wrong state, action, answer, or numeric expectation',
    };
  } catch {
    return { pass: false, reason: 'Rejected by command validator' };
  }
}

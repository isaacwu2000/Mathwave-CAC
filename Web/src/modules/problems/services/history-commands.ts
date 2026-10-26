import {
  parseHistoryCommand,
  runCommand,
  type HistoryContext,
} from '../../commands/index.ts';
import { ClarificationError } from '../../math/index.ts';
import { describeWorkspace } from '../../workspace/state.ts';
import {
  cancelStep,
  currentProblem,
  redoStep,
  recordStep,
  restoreStep,
  undoStep,
  type ProblemLibrary,
} from './problem-library.ts';

export function historyContext(book: ProblemLibrary): HistoryContext {
  const p = currentProblem(book);
  return {
    steps: p.steps.slice(-50).map((s, i) => ({
      number: Math.max(0, p.steps.length - 50) + i + 1,
      command: (s.displayCommand || s.command).slice(0, 250),
    })),
    total: p.steps.length,
    undoCount: p.undoRevisions?.length ?? p.undoStates?.length ?? 0,
    redoCount: p.redoRevisions?.length ?? 0,
  };
}
export function applyHistoryCommand(
  book: ProblemLibrary,
  text: string,
): { book: ProblemLibrary; message: string } | null {
  const action = parseHistoryCommand(text, historyContext(book));
  if (!action) return null;
  if (action.kind === 'revise') {
    // Replace this step from its preceding state; restoreStep retains later work for recovery.
    const restored = restoreStep(book, action.number - 1);
    const command = `write ${action.expression}`;
    const result = runCommand(currentProblem(restored).state, command);
    return {
      book: recordStep(restored, result.state, command),
      message: `Revised step ${action.number}. Your previous work is saved in history.`,
    };
  }
  if (action.kind === 'read')
    return {
      book,
      message: `Step ${action.number}. ${currentProblem(book).steps[action.number - 1].displayCommand || currentProblem(book).steps[action.number - 1].command}. ${describeWorkspace(currentProblem(book).steps[action.number - 1].state)}`,
    };
  let next = book;
  try {
    if (action.kind === 'undo' || action.kind === 'redo') {
      for (let i = 0; i < action.count; i++)
        next = action.kind === 'undo' ? undoStep(next) : redoStep(next);
    } else if (action.kind === 'restore')
      next = restoreStep(book, action.number);
    else if (action.kind === 'cancel') next = cancelStep(book, action.number);
  } catch {
    throw new ClarificationError(
      'A later step depends on that work. Return to the step before it to revise the problem; your work is unchanged.',
    );
  }
  const label =
    action.kind === 'cancel'
      ? `Cancelled step ${action.number}.`
      : action.kind === 'restore'
        ? `Returned to step ${action.number}.`
        : action.kind === 'redo'
          ? 'Redid your work.'
          : 'Undid your work.';
  return {
    book: next,
    message: `${label} ${describeWorkspace(currentProblem(next).state)}`,
  };
}

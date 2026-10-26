import {
  type Interpretation,
  validateConversation,
  validateConversationArchive,
  workspaceKey,
  commandSource,
} from '../../commands/index.ts';
import {
  type Presentation,
  setExplorationValue,
  validatePresentation,
} from '../../visuals/index.ts';
import { applyMathPlan } from './math-plan.ts';
import {
  contentChanged,
  currentProblem,
  type ProblemLibrary,
  undoStep,
  updateProblem,
} from './problem-library.ts';
export function rememberConversation(
  before: ProblemLibrary,
  after: ProblemLibrary,
  request: string,
  response: string,
  status: Interpretation['status'],
  commands?: string[],
  undoDepth = 1,
  interaction?: string,
): ProblemLibrary {
  if (before.problemId !== after.problemId) return after;
  const original = currentProblem(before),
    p = currentProblem(after);
  const revisable =
    status === 'correction' ||
    (status === 'command' && contentChanged(original.state, p.state));
  const turn = {
    request: request.slice(0, 2000),
    response: response.slice(0, 1000),
    status,
    commands: ['reply', 'explanation'].includes(status)
      ? commands?.map((command) => commandSource(command, p.state))
      : undefined,
    interaction,
    stateKey: workspaceKey(p.state),
    revisable,
    stepCount: p.steps.length,
    undoDepth: revisable ? undoDepth : undefined,
  };
  const previous = p.conversation || [];
  const coalesced =
    interaction && previous.at(-1)?.interaction === interaction
      ? previous.slice(0, -1)
      : previous;
  const all = [...coalesced, turn];
  const recent = all.slice(-12);
  const archived = [...(p.conversationArchive || []), ...all.slice(0, -12)];
  while (recent.length > 1 && JSON.stringify(recent).length > 12000)
    archived.push(recent.shift()!);
  if (JSON.stringify(recent).length > 12000) {
    turn.commands = undefined;
    turn.revisable = false;
  }
  const conversation = validateConversation(recent);
  // Keep old context outside the recent window; transport selects relevant turns later.
  while (archived.length > 48 || JSON.stringify(archived).length > 32000) {
    const lastOperation = archived.findLast((t) => t.revisable);
    const removable = archived.findIndex((t) => t !== lastOperation);
    if (removable < 0) break;
    archived.splice(removable, 1);
  }
  const conversationArchive = validateConversationArchive(archived);
  return updateProblem(after, (p) => ({
    ...p,
    conversation,
    conversationArchive,
  }));
}
export function correctConversation(
  book: ProblemLibrary,
  commands: string[],
  request: string,
) {
  const current = currentProblem(book);
  const target = [
    ...(current.conversationArchive || []),
    ...(current.conversation || []),
  ].findLast((t) => t.revisable);
  if (
    !target ||
    target.stateKey !== workspaceKey(current.state) ||
    target.stepCount !== current.steps.length
  )
    throw new Error(
      'Your work changed since that turn. Name the saved step to correct; nothing was changed.',
    );
  let base = book;
  for (let i = 0; i < (target.undoDepth || 1); i++) {
    const next = undoStep(base);
    if (next === base)
      throw new Error(
        'That correction is no longer available in undo history.',
      );
    base = next;
  }
  const applied = applyMathPlan(base, commands);
  if (!applied.stepsAdded)
    throw new Error(
      'A correction must replace the previous operation with a supported math change.',
    );
  const next = updateProblem(applied.book, (p) => ({
    ...p,
    conversation: current.conversation,
    conversationArchive: current.conversationArchive,
    undoRevisions: [
      ...(current.undoRevisions || []),
      {
        state: current.state,
        steps: current.steps,
        undoStates: current.undoStates || [],
      },
    ].slice(-50),
    redoRevisions: [],
  }));
  const message = `Corrected the previous turn. ${applied.message} Say undo to restore the previous work.`;
  const remembered = rememberConversation(
    book,
    next,
    request,
    message,
    'correction',
    commands,
    (target.undoDepth || 1) + 1,
  );
  return { ...applied, book: remembered, message };
}

/** Teaching surfaces are separate from the student's saved mathematical steps. */
export function presentExplanation(
  book: ProblemLibrary,
  presentation?: Presentation,
): ProblemLibrary {
  if (!presentation) return book;
  const validated = validatePresentation(presentation)!;
  return updateProblem(book, (p) => ({
    ...p,
    exploration: validated.action === 'show' ? validated.content : undefined,
  }));
}
export function adjustExplanation(
  book: ProblemLibrary,
  name: string,
  value: number,
): ProblemLibrary {
  const lesson = currentProblem(book).exploration;
  if (!lesson) throw new Error('There is no interactive explanation open.');
  const exploration = setExplorationValue(lesson, name, value);
  const next = updateProblem(book, (p) => ({ ...p, exploration }));
  // A changed control supersedes any earlier suggestion derived from old values.
  return rememberConversation(
    book,
    next,
    `Set ${name} to ${value} in the interactive explanation.`,
    `${lesson.title}: ${name} is now ${value}.`,
    'reply',
    undefined,
    1,
    `control:${name}`,
  );
}

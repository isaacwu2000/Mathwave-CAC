import {
  verifyLinearCompletion,
  hasInexactCompletionLiteral,
} from '../../math/index.ts';
import type { Problem } from '../types/problem-library.ts';
import type { VerifiedCompletion } from '../types/completion.ts';

/** Accepts the agent's completion judgment for any subject; direct linear commands retain their exact check. */
export function verifiedCompletion(
  before: Problem,
  after: Problem,
  commands: string[],
  decision?: { answer: string } | null,
): VerifiedCompletion | null {
  if (before.id !== after.id) return null;
  if (decision === null) return null;
  if (decision)
    return {
      problemId: after.id,
      equation: before.state.expression,
      answer: decision.answer,
    };
  if (
    before.id !== after.id ||
    after.state.mode !== 'equation' ||
    after.state.graph
  )
    return null;
  // Saved expressions normalize numeric literals; inspect the retained commands before trusting that form.
  const sources = [
    ...after.steps.flatMap((step) => [step.command, step.displayCommand || '']),
    ...commands,
  ];
  if (sources.some(hasInexactCompletionLiteral)) return null;
  const solve = commands.some((command) =>
    /^(solve|solve it|solve the equation|solve step by step)$/i.test(
      command.trim(),
    ),
  );
  if (
    !solve &&
    (after.steps.length <= before.steps.length ||
      before.state.expression === after.state.expression)
  )
    return null;
  const original = [
    after.initialState,
    ...after.steps.map((step) => step.state),
  ].find(
    (state) => state?.mode === 'equation' && state.expression.includes('='),
  );
  if (!original || original.graph) return null;
  const answer = verifyLinearCompletion(
    original.expression,
    after.state.expression,
    solve,
  );
  return answer
    ? { problemId: after.id, equation: original.expression, answer }
    : null;
}

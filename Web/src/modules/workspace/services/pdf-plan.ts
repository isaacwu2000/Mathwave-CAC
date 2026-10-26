import { blankWorkspace, contentChanged } from '../../problems/index.ts';
import type { ProblemLibrary } from '../../problems/index.ts';

/**
 * - Copies saved problems and the active draft for one problem or the entire library.
 * - Includes current work and camera bounds without adding camera-only steps.
 * - Never changes stored work; rejects a missing selected problem.
 */
export function planProblemsPdf(book: ProblemLibrary, problemId?: string) {
  const problems = book.assignments
    .flatMap((a) => a.problems)
    .filter((p) => problemId === undefined || p.id === problemId)
    .map((saved) => {
      const p = structuredClone(saved);
      const last = p.steps.at(-1);
      if (contentChanged(last?.state ?? blankWorkspace(), p.state)) {
        p.steps.push({ command: 'Current work', state: p.state, at: '' });
      } else if (last) {
        // Camera changes are not mathematical steps; keep the latest view of the last step.
        p.steps[p.steps.length - 1] = { ...last, state: p.state };
      }
      return {
        ...p,
        draft: p.id === book.problemId ? book.draft : p.draft || '',
      };
    });
  if (!problems.length) throw new Error('There are no problems to export.');
  return problems;
}

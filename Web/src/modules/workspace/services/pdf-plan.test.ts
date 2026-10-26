import { expect, test } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  startProblem,
} from '../../problems/index.ts';
import { planProblemsPdf } from './pdf-plan.ts';

test('one problem exports its saved work and active draft without other problems or mutations', () => {
  let book = createProblemLibrary();
  const first = currentProblem(book).id;
  book = recordStep(
    book,
    { ...currentProblem(book).state, expression: 'x=4' },
    'write x=4',
  );
  book = startProblem(book, 'Geometry');
  book = { ...book, draft: 'try a triangle' };
  const before = JSON.stringify(book);
  const selected = planProblemsPdf(book, first);
  expect(selected.map((p) => p.title)).toEqual(['Problem 1']);
  expect(selected[0].steps.map((s) => s.state.expression)).toEqual(['x=4']);
  expect(selected[0].draft).toBe('');
  expect(planProblemsPdf(book).map((p) => p.draft)).toEqual([
    '',
    'try a triangle',
  ]);
  expect(JSON.stringify(book)).toBe(before);
});

test('exports the latest graph view without inventing a camera step', () => {
  let book = createProblemLibrary();
  book = recordStep(
    book,
    { ...currentProblem(book).state, expression: 'x^2', graph: true },
    'graph x^2',
  );
  currentProblem(book).state = {
    ...currentProblem(book).state,
    graphRange: { min: -2, max: 2 },
  };
  const [problem] = planProblemsPdf(book);
  expect(problem.steps).toHaveLength(1);
  expect(problem.steps[0].state.graphRange).toEqual({ min: -2, max: 2 });
  expect(currentProblem(book).steps[0].state.graphRange).toBeUndefined();
});

test('includes changed current work even when it has no saved step', () => {
  const book = createProblemLibrary();
  currentProblem(book).state.expression = 'x=9';
  expect(planProblemsPdf(book)[0].steps.map((s) => s.state.expression)).toEqual(
    ['x=9'],
  );
  expect(currentProblem(book).steps).toHaveLength(0);
});

test('rejects a missing problem and keeps blank problems empty', () => {
  const book = createProblemLibrary();
  expect(() => planProblemsPdf(book, 'missing')).toThrow(
    'There are no problems to export.',
  );
  expect(planProblemsPdf(book)[0].steps).toEqual([]);
});

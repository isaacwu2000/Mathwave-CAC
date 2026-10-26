import { test, expect } from 'vitest';
import { applyCloudOperation } from './cloud-problem-library.ts';
import {
  createProblemLibrary,
  currentProblem,
  undoStep,
  cancelStep,
} from '../index.ts';

test('one graph build saves one replayable step and undo restores the previous graph', async () => {
  const initial = { book: createProblemLibrary(), clarification: null };
  const first = await applyCloudOperation(initial, {
    kind: 'command',
    text: 'graph y=x',
    interpret: false,
  });
  const built = await applyCloudOperation(first, {
    kind: 'graph',
    commands: ['graph y=x^2', 'add graph y=3'],
    text: 'compare a parabola and three',
    baseRevision: 1,
  });
  expect(currentProblem(built.book).steps).toHaveLength(2);
  expect(currentProblem(undoStep(built.book)).state.expression).toBe('y = x');
  expect(
    currentProblem(cancelStep(built.book, 1)).state.graphExpressions,
  ).toEqual(['y = 3']);
});

test('a graph clarification retains the request without creating a mathematical step', async () => {
  const asked = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    {
      kind: 'graph-question',
      text: 'draw a circle',
      question: 'What radius?',
      baseRevision: 0,
    },
  );
  expect(asked.clarification).toEqual({
    request: 'draw a circle',
    question: 'What radius?',
  });
  expect(currentProblem(asked.book).steps).toHaveLength(0);
  const answered = await applyCloudOperation(asked, {
    kind: 'graph',
    text: 'five',
    commands: ['circle radius 5'],
    baseRevision: 1,
  });
  expect(currentProblem(answered.book).state.geometry?.dimensions.radius).toBe(
    5,
  );
  expect(answered.clarification).toBeNull();
});

test('repeated requests to graph the same equation do not create duplicate steps', async () => {
  let saved: Parameters<typeof applyCloudOperation>[0] = {
    book: createProblemLibrary(),
    clarification: null,
  };
  for (let i = 0; i < 12; i++) {
    const result = await applyCloudOperation(saved, {
      kind: 'command',
      text: 'graph x^3+5*x^2+6',
      interpret: false,
    });
    saved = { book: result.book, clarification: result.clarification };
  }
  expect(currentProblem(saved.book).steps).toHaveLength(1);
  expect(currentProblem(undoStep(saved.book)).steps).toHaveLength(0);
});

test('replayed AI graph programs also retain one equation step', async () => {
  let saved: Parameters<typeof applyCloudOperation>[0] = {
    book: createProblemLibrary(),
    clarification: null,
  };
  const text =
    'typescript\nconst g = graph.plot("x^3+5*x^2+6"); problem.save(g);';
  for (let i = 0; i < 12; i++)
    saved = await applyCloudOperation(saved, {
      kind: 'command',
      text,
      interpret: false,
    });
  expect(currentProblem(saved.book).steps).toHaveLength(1);
  expect(currentProblem(undoStep(saved.book)).steps).toHaveLength(0);
});

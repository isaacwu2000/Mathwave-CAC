import { expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  restoreStep,
} from '../../../Web/src/modules/problems/index.ts';
import { capturePlan, captureOutcomes } from './capture_llm_outcomes.ts';
import type { ExperimentRow, PredictionGrade } from './grade_predictions.ts';

/** Builds isolated literal saved graph states; no model or browser is used. */
function fixtures() {
  const empty = createProblemLibrary();
  let book = empty;
  const books = [];
  for (const expression of ['x', 'x ^ 2', 'x ^ 3']) {
    book = recordStep(
      book,
      {
        ...currentProblem(book).state,
        mode: 'equation',
        expression,
        graph: true,
      },
      'typescript\nproblem.save(graph.plot("' + expression + '"));',
    );
    books.push(book);
  }
  const row: ExperimentRow = {
    id: 'capture:graph:2',
    caseId: 'graph',
    family: 'graph',
    category: 'graphs',
    turn: 2,
    stage: 'final',
    split: 'test',
    request: { request: 'Square it, then cube it.' },
    messages: [],
    expected: {
      interpretation: {},
      before: { book: books[0], clarification: null },
      after: { book: books[2], status: 'command', message: 'Saved.' },
      assertions: { graph: true, stepDelta: 2 },
    },
  };
  const grade: PredictionGrade = {
    id: row.id,
    caseId: row.caseId,
    category: row.category,
    stage: 'final',
    syntaxValid: true,
    semanticCorrect: true,
    groundedReplyAssertionsSatisfied: null,
    replyReferenceMatch: null,
    exactTarget: false,
    pass: true,
    reasons: [],
    book: books[2],
  };
  return { row, grade };
}

test('maps every newly saved graph intermediate plus final state at mobile and desktop widths', () => {
  const { row, grade } = fixtures();
  const plan = capturePlan(row, grade);
  expect(plan.snapshots.map((snapshot) => snapshot.name)).toEqual([
    'intermediate-step-2',
    'final',
  ]);
  expect(
    plan.snapshots.map(
      (snapshot) => currentProblem(snapshot.book).state.expression,
    ),
  ).toEqual(['x ^ 2', 'x ^ 3']);
  expect(
    plan.snapshots.map((snapshot) =>
      snapshot.viewports.map((viewport) => viewport.width),
    ),
  ).toEqual([
    [390, 1280],
    [390, 1280],
  ]);
  expect(plan.expectedAssertions).toEqual({ graph: true, stepDelta: 2 });
  expect(currentProblem(grade.book!).steps).toHaveLength(3);
});

test('labels invalid generation fallback honestly and never substitutes the reference result', () => {
  const { row, grade } = fixtures();
  delete grade.book;
  grade.pass = false;
  grade.reasons = ['Invalid model JSON.'];
  const plan = capturePlan(row, grade);
  expect(plan.source).toBe('unchanged-prestate-no-executable-outcome');
  expect(plan.snapshots).toHaveLength(1);
  expect(currentProblem(plan.snapshots[0].book).state.expression).toBe('x');
  expect(plan.reasons).toEqual(['Invalid model JSON.']);
});

test('simple equations use the primary mobile viewport without redundant desktop captures', () => {
  const { row, grade } = fixtures();
  const book = structuredClone(grade.book!);
  currentProblem(book).state.graph = false;
  for (const step of currentProblem(book).steps) step.state.graph = false;
  currentProblem(row.expected.before.book).state.graph = false;
  for (const step of currentProblem(row.expected.before.book).steps)
    step.state.graph = false;
  grade.book = book;
  const plan = capturePlan(row, grade);
  expect(plan.snapshots).toHaveLength(1);
  expect(plan.snapshots[0].viewports).toEqual([{ width: 390, height: 844 }]);
});

test('retains an intermediate graph even when the final saved mode is an equation', () => {
  const { row, grade } = fixtures();
  const book = structuredClone(grade.book!);
  currentProblem(book).state.graph = false;
  grade.book = book;
  const plan = capturePlan(row, grade);
  expect(plan.snapshots.map((snapshot) => snapshot.name)).toEqual([
    'intermediate-step-2',
    'final',
  ]);
  expect(currentProblem(plan.snapshots[0].book).state.graph).toBe(true);
  expect(plan.snapshots[1].viewports.map((viewport) => viewport.width)).toEqual(
    [390],
  );
});

test('correction history compares the retained prefix before locating new progressive states', () => {
  const { row, grade } = fixtures();
  const before = grade.book!;
  row.expected.before.book = before;
  let revised = restoreStep(structuredClone(before), 1);
  for (const [expression, graph] of [
    ['x ^ 4', true],
    ['x = 5', false],
  ] as const)
    revised = recordStep(
      revised,
      { ...currentProblem(revised).state, expression, graph },
      'write ' + expression,
    );
  grade.book = revised;
  const plan = capturePlan(row, grade);
  expect(plan.snapshots.map((snapshot) => snapshot.name)).toEqual([
    'intermediate-step-2',
    'final',
  ]);
  expect(currentProblem(plan.snapshots[0].book).state.expression).toBe('x ^ 4');
  expect(currentProblem(plan.snapshots[1].book).state.expression).toBe('x = 5');
});

test('rejects duplicate dataset IDs and unrelated grade IDs before starting a browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mathwave-capture-id-check-'));
  try {
    const { row, grade } = fixtures();
    const data = join(directory, 'data.jsonl'),
      grades = join(directory, 'grades.json');
    await writeFile(
      data,
      JSON.stringify(row) + '\n' + JSON.stringify(row) + '\n',
    );
    await writeFile(grades, JSON.stringify({ results: [grade] }));
    await expect(
      captureOutcomes(
        data,
        grades,
        'http://localhost:1',
        join(directory, 'duplicates'),
      ),
    ).rejects.toThrow('uniquely cover');
    await writeFile(data, JSON.stringify(row) + '\n');
    await writeFile(
      grades,
      JSON.stringify({ results: [grade, { ...grade, id: 'unrelated' }] }),
    );
    await expect(
      captureOutcomes(
        data,
        grades,
        'http://localhost:1',
        join(directory, 'extras'),
      ),
    ).rejects.toThrow('uniquely cover');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

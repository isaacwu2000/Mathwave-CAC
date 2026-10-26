import { expect, test } from 'vitest';
import { removeFlowchartProblems } from './remove-flowchart-problems.ts';
import {
  createProblemLibrary,
  currentProblem,
  startProblem,
  recordStep,
} from '../src/modules/problems/index.ts';
import { runCommand } from '../src/modules/commands/index.ts';
test('deletes an entire flowchart problem and preserves other problems and their math', () => {
  let book = createProblemLibrary();
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, 'write x=7').state,
    'write x=7',
  );
  const math = structuredClone(currentProblem(book));
  book = startProblem(book);
  const raw = JSON.parse(JSON.stringify(book));
  raw.assignments[0].problems[1].state.mode = 'diagram';
  const cleaned = removeFlowchartProblems(raw);
  expect(cleaned.removed).toBe(1);
  expect(cleaned.book.assignments[0].problems).toEqual([math]);
  expect(cleaned.book.problemId).toBe(math.id);
});
test('replaces a library containing only flowcharts with a blank problem', () => {
  const raw = JSON.parse(JSON.stringify(createProblemLibrary()));
  raw.assignments[0].problems[0].state.mode = 'diagram';
  const cleaned = removeFlowchartProblems(raw);
  expect(cleaned.removed).toBe(1);
  expect(currentProblem(cleaned.book).steps).toEqual([]);
  expect(currentProblem(cleaned.book).state.mode).toBe('equation');
});

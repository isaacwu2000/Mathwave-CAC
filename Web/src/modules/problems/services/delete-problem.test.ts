import { expect, test } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  startProblem,
  saveDraft,
  decodeProblemLibrary,
} from '../index.ts';
import { applyCloudOperation } from './cloud-problem-library.ts';

test('deleting an inactive problem preserves the current problem and draft after reload', async () => {
  let book = createProblemLibrary();
  const removed = book.problemId;
  book = saveDraft(startProblem(book), 'unsent working draft');
  const selected = book.problemId;
  const original = JSON.stringify(book);
  const result = await applyCloudOperation(
    { book, clarification: null },
    { kind: 'delete', assignmentId: book.assignmentId, problemId: removed },
  );
  const restored = decodeProblemLibrary(JSON.stringify(result.book));
  expect(restored.problemId).toBe(selected);
  expect(restored.draft).toBe('unsent working draft');
  expect(
    restored.assignments
      .flatMap((a) => a.problems)
      .some((p) => p.id === removed),
  ).toBe(false);
  expect(JSON.stringify(book)).toBe(original);
});

test('deleting the active problem opens another saved problem with its draft', async () => {
  let book = saveDraft(createProblemLibrary(), 'first problem draft');
  const kept = book.problemId;
  book = startProblem(book);
  const result = await applyCloudOperation(
    {
      book,
      clarification: { request: 'old request', question: 'old question' },
    },
    {
      kind: 'delete',
      assignmentId: book.assignmentId,
      problemId: book.problemId,
    },
  );
  expect(result.book.problemId).toBe(kept);
  expect(result.book.draft).toBe('first problem draft');
  expect(result.clarification).toBeNull();
});

test('deleting the last problem in an assignment switches across assignments', async () => {
  let book = createProblemLibrary();
  const kept = book.problemId;
  book = startProblem(book, 'Second', 'Second assignment');
  const removedAssignment = book.assignmentId;
  const result = await applyCloudOperation(
    { book, clarification: null },
    {
      kind: 'delete',
      assignmentId: book.assignmentId,
      problemId: book.problemId,
    },
  );
  expect(result.book.problemId).toBe(kept);
  expect(result.book.assignments.some((a) => a.id === removedAssignment)).toBe(
    false,
  );
  expect(() => decodeProblemLibrary(JSON.stringify(result.book))).not.toThrow();
});

test('deleting the only problem starts a blank one; a repeated delete cannot remove it', async () => {
  const book = createProblemLibrary();
  const operation = {
    kind: 'delete' as const,
    assignmentId: book.assignmentId,
    problemId: book.problemId,
  };
  const result = await applyCloudOperation(
    { book, clarification: null },
    operation,
  );
  expect(result.book.problemId).not.toBe(book.problemId);
  expect(currentProblem(result.book).steps).toEqual([]);
  expect(currentProblem(result.book).state.expression).toBe('0');
  expect(() => decodeProblemLibrary(JSON.stringify(result.book))).not.toThrow();
  const retried = await applyCloudOperation(result, operation);
  expect(retried.book).toEqual(result.book);
});

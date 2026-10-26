import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createProblemLibrary,
  currentProblem,
  saveDraft,
  selectProblem,
  startProblem,
  recordStep,
  undoStep,
  decodeProblemLibrary,
  problemLibraryText,
  currentProblemText,
  contentChanged,
  updateProblem,
} from '../index.ts';
import { runCommand } from '../../commands/index.ts';

test('next problem preserves unfinished work and returning restores the correct draft after reload', () => {
  const first = saveDraft(createProblemLibrary(), '2x +');
  const second = saveDraft(startProblem(first), 'median of 4,');
  const restored = decodeProblemLibrary(JSON.stringify(second));
  const back = selectProblem(restored, first.assignmentId, first.problemId);
  assert.equal(back.draft, '2x +');
  assert.equal(currentProblem(back).draft, '2x +');
  const forward = selectProblem(back, second.assignmentId, second.problemId);
  assert.equal(forward.draft, 'median of 4,');
  assert.match(problemLibraryText(forward), /Unsubmitted draft: 2x \+/);
  assert.match(problemLibraryText(forward), /Unsubmitted draft: median of 4,/);
  assert.equal(
    first.assignments[0].problems.length,
    1,
    'transition does not mutate old problem',
  );
});
test('new assignment retains prior work, resets the canvas, and has an independent undo history', () => {
  let first = createProblemLibrary();
  first = recordStep(
    first,
    runCommand(currentProblem(first).state, 'x = 4').state,
    'x = 4',
  );
  first = saveDraft(first, 'divide both sides by');
  const next = startProblem(first, undefined, 'Calculus');
  assert.equal(next.assignments.length, 2);
  assert.equal(currentProblem(next).title, 'Problem 1');
  assert.equal(currentProblem(next).steps.length, 0);
  assert.equal(next.draft, '');
  assert.equal(undoStep(next), next);
  const restored = selectProblem(next, first.assignmentId, first.problemId);
  assert.equal(currentProblem(restored).state.expression, 'x = 4');
  assert.equal(restored.draft, 'divide both sides by');
});
test('undo in the second problem cannot change the first problem', () => {
  let first = createProblemLibrary();
  first = recordStep(
    first,
    runCommand(currentProblem(first).state, 'x = 4').state,
    'x = 4',
  );
  let next = startProblem(first);
  next = recordStep(
    next,
    runCommand(currentProblem(next).state, 'data 1, 2, 20').state,
    'data 1, 2, 20',
  );
  next = undoStep(decodeProblemLibrary(JSON.stringify(next)));
  assert.equal(currentProblem(next).steps.length, 0);
  assert.equal(
    currentProblem(selectProblem(next, first.assignmentId, first.problemId))
      .state.expression,
    'x = 4',
  );
});
test('one problem transforms from equation to data to geometry without creating other problems', () => {
  let book = createProblemLibrary();
  for (const command of [
    '2x + 3 = 11',
    'subtract three from both sides',
    'data 1, 4, 9',
    'circle radius 5',
  ]) {
    const result = runCommand(currentProblem(book).state, command);
    assert.ok(
      result.written ||
        contentChanged(currentProblem(book).state, result.state),
    );
    book = recordStep(book, result.state, command);
  }
  assert.equal(book.assignments[0].problems.length, 1);
  assert.equal(currentProblem(book).state.mode, 'geometry');
  book = undoStep(book);
  assert.equal(currentProblem(book).state.mode, 'statistics');
  book = undoStep(book);
  assert.equal(currentProblem(book).state.mode, 'equation');
  assert.equal(currentProblem(book).steps.length, 2);
});
test('statistics queries and graph exploration preserve the unfinished draft and saved step count', () => {
  let book = createProblemLibrary();
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, 'data 1, 4, 9').state,
    'data 1, 4, 9',
  );
  book = saveDraft(book, 'next unfinished idea');
  for (const command of [
    'median',
    'find outliers',
    'equations',
    'graph',
    'hide graph',
  ]) {
    const old = currentProblem(book);
    const result = runCommand(old.state, command);
    assert.equal(contentChanged(old.state, result.state), false);
    book = updateProblem(book, (p) => ({ ...p, state: result.state }));
    assert.equal(book.draft, 'next unfinished idea');
    assert.equal(currentProblem(book).steps.length, 1);
  }
});
test('unknown problem selection fails without modifying the saved problem', () => {
  const book = saveDraft(createProblemLibrary(), 'unfinished');
  const before = JSON.stringify(book);
  assert.throws(() => selectProblem(book, book.assignmentId, 'missing'));
  assert.throws(() => selectProblem(book, 'missing', book.problemId));
  assert.equal(JSON.stringify(book), before);
});

test('current problem export excludes other problems and retains the active draft', () => {
  const first = saveDraft(
    createProblemLibrary(),
    'private unfinished first problem',
  );
  const second = saveDraft(
    startProblem(first, 'Export this problem'),
    '2x + 3 = 11',
  );
  const before = JSON.stringify(second);
  const output = currentProblemText(second);
  assert.match(output, /Export this problem/);
  assert.match(output, /Unsubmitted draft: 2x \+ 3 = 11/);
  assert.doesNotMatch(output, /private unfinished|Problem 1/);
  assert.equal(JSON.stringify(second), before);
});

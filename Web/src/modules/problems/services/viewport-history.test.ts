import { expect, test } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  rememberConversation,
  correctConversation,
} from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { normalizeViewportHistory } from './viewport-history.ts';

test('old viewport duplicates disappear without losing real equations, graph ranges or recovery snapshots', () => {
  let book = createProblemLibrary();
  for (const command of [
    'graph x^3+5*x^2+6',
    'view x -9 to 9 y -9 to 9',
    'view x -8 to 8 y -8 to 8',
    'write x+1',
    'view x -7 to 7 y -7 to 7',
  ])
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  const original = JSON.stringify(book);
  const clean = normalizeViewportHistory(book);
  expect(
    currentProblem(clean).steps.map((s) => s.displayCommand || s.command),
  ).toEqual(['graph x^3+5*x^2+6', 'write x+1']);
  expect(currentProblem(clean).state).toEqual(currentProblem(book).state);
  const previous = undoStep(clean);
  expect(currentProblem(previous).steps).toHaveLength(1);
  expect(currentProblem(undoStep(previous)).steps).toHaveLength(0);
  expect(normalizeViewportHistory(clean)).toEqual(clean);
  expect(JSON.stringify(book)).toBe(original);
});

test('a conversational correction still targets its real operation after viewport cleanup', () => {
  let book = createProblemLibrary();
  for (const command of [
    'graph x^2',
    'view x -9 to 9 y -9 to 9',
    'view x -8 to 8 y -8 to 8',
  ])
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  const before = book;
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, 'write x+1=0').state,
    'write x+1=0',
  );
  book = rememberConversation(
    before,
    book,
    'write x plus one equals zero',
    'Written',
    'command',
    ['write x+1=0'],
  );
  const clean = normalizeViewportHistory(book);
  const corrected = correctConversation(
    clean,
    ['write x+2=0'],
    'actually two',
  ).book;
  expect(currentProblem(corrected).state.expression).toBe('x + 2 = 0');
  expect(currentProblem(corrected).steps).toHaveLength(2);
});

test('a camera-only first row is removed against the original problem state', () => {
  let book = createProblemLibrary();
  for (const command of ['view x -9 to 9 y -9 to 9', 'graph x^2'])
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  const clean = normalizeViewportHistory(book);
  expect(
    currentProblem(clean).steps.map(
      (step) => step.displayCommand || step.command,
    ),
  ).toEqual(['graph x^2']);
  expect(currentProblem(undoStep(clean)).steps).toHaveLength(0);
  expect(currentProblem(clean).state).toEqual(currentProblem(book).state);
});

test('legacy identical graph writes are cleaned without losing the original graph or undo', () => {
  const initial = createProblemLibrary();
  const state = runCommand(currentProblem(initial).state, 'graph x^2').state;
  const book = recordStep(initial, state, 'graph x^2');
  const problem = currentProblem(book);
  for (let i = 1; i < 12; i++) {
    problem.undoRevisions!.push({
      state,
      steps: [...problem.steps],
      undoStates: [...problem.undoStates!],
    });
    problem.steps.push({
      command: 'graph x^2',
      state,
      at: `2026-10-15T12:00:${String(i).padStart(2, '0')}.000Z`,
    });
    problem.undoStates!.push(state);
  }
  const original = JSON.stringify(book);
  const cleaned = normalizeViewportHistory(book);
  expect(currentProblem(cleaned).steps).toHaveLength(1);
  expect(currentProblem(cleaned).state).toEqual(state);
  expect(currentProblem(undoStep(cleaned)).steps).toHaveLength(0);
  expect(normalizeViewportHistory(cleaned)).toEqual(cleaned);
  expect(JSON.stringify(book)).toBe(original);
});

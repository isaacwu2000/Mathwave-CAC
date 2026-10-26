import { test } from 'vitest';
import assert from 'node:assert/strict';
import { includeGraphValue, validateGraphTrace } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  contentChanged,
  decodeProblemLibrary,
  updateProblem,
} from '../../problems/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('exact tracing selects a curve and moves view without a math edit', () => {
  let book = createProblemLibrary();
  for (const command of ['graph y=x^2', 'add graph y=2*x+1']) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, command);
  }
  const original = currentProblem(book).state;
  const result = runCommand(original, 'trace graph two at x 20.125');
  assert.deepEqual(result.state.graphTrace, {
    graph: 2,
    x: 20.125,
    expression: 'y = 2 * x + 1',
  });
  assert.match(result.message, /y = 41.25/);
  assert.ok(
    result.state.graphRange!.min <= 20.125 &&
      result.state.graphRange!.max >= 20.125,
  );
  assert.ok(
    result.state.graphYRange!.min <= 41.25 &&
      result.state.graphYRange!.max >= 41.25,
  );
  assert.equal(contentChanged(original, result.state), false);
  book = updateProblem(book, (p) => ({ ...p, state: result.state }));
  assert.equal(currentProblem(book).steps.length, 2);
  assert.deepEqual(
    currentProblem(decodeProblemLibrary(JSON.stringify(book))).state.graphTrace,
    result.state.graphTrace,
  );
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'trace graph two at x 20.125',
        message: '',
      },
      original,
    ).command,
    'trace graph 2 at x 20.125',
  );
});
test('undefined trace points and viewport edges remain bounded and readable', () => {
  const state = runCommand(initialWorkspace, 'graph y=1/x').state;
  const r = runCommand(state, 'trace graph 1 at x zero');
  assert.match(r.message, /undefined/);
  assert.equal(r.state.graphTrace!.x, 0);
  assert.deepEqual(runCommand(state, 'evaluate graph 1 at x 2').state, state);
  assert.deepEqual(includeGraphValue({ min: -10, max: 10 }, 1e6), {
    min: 999980,
    max: 1e6,
  });
  assert.deepEqual(includeGraphValue({ min: -10, max: 10 }, -1e6), {
    min: -1e6,
    max: -999980,
  });
  assert.throws(
    () => runCommand(state, 'trace graph 9 at x 1'),
    /does not exist/,
  );
  assert.throws(
    () => runCommand(state, 'trace graph 1 at x 1000001'),
    /finite x/,
  );
  for (const bad of [
    { graph: 0, x: 1, expression: 'x' },
    { graph: 1, x: Infinity, expression: 'x' },
    { graph: 1, x: 0, expression: 'x+y' },
  ])
    assert.throws(() => validateGraphTrace(bad));
});

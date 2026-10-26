import { test } from 'vitest';
import assert from 'node:assert/strict';
import { shiftGraph, graphFunction, numberedGraphs } from '../index.ts';
import { parseGeometry, geometryMeasures, scaleGeometry } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
  decodeProblemLibrary,
} from '../../problems/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('curve shifts change functions, preserve other curves, and recover through undo', () => {
  for (const expr of ['y=x^2', 'sin(x)', 'x+1=y', '1/x'])
    for (const [right, up] of [
      [2, 3],
      [-1, -4],
      [0, 0],
    ]) {
      const moved = graphFunction(shiftGraph(expr, right, up));
      for (const x of [-3, 0, 4]) {
        const before = graphFunction(expr).value(x - right);
        assert.equal(moved.value(x), before === null ? null : before + up);
      }
    }
  assert.throws(() => shiftGraph('x^2=4', 2, 3), /implicit/);
  assert.throws(() => shiftGraph('x', Infinity, 0), /finite/);
  let book = createProblemLibrary();
  for (const command of [
    'graph y=x^2',
    'add graph y=2*x',
    'shift graph 2 left 3 down 1',
  ]) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, r.storedCommand || command);
  }
  const state = currentProblem(book).state;
  assert.equal(graphFunction(state.graphExpressions![0]).value(0), 5);
  assert.equal(state.expression, 'y = x^2');
  assert.deepEqual(currentProblem(redoStep(undoStep(book))).state, state);
  assert.deepEqual(
    currentProblem(decodeProblemLibrary(JSON.stringify(book))).state,
    state,
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'shift graph 1 right 2 up 3', message: '' },
      state,
    ).status,
    'command',
  );
});
test('regular polygons validate side count, lengths and scale only physical dimensions', () => {
  const square = parseGeometry('regular polygon sides four side three')!;
  const m = geometryMeasures(square);
  assert.equal(m.perimeter.value, 12);
  assert.ok(Math.abs(m.area.value - 9) < 1e-10);
  assert.equal(m['interior angle'].value, 90);
  assert.equal(m['exterior angle'].value, 90);
  assert.deepEqual(scaleGeometry(square, 2).dimensions, { sides: 4, side: 6 });
  for (const count of [2, 3.5, 51])
    assert.throws(
      () => parseGeometry(`regular polygon sides ${count} side 3`),
      /side count/,
    );
  assert.throws(() => parseGeometry('regular polygon sides five'), /side\?/);
  const state = runCommand(
    initialWorkspace,
    'regular polygon sides 6 side 2',
  ).state;
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'interior angle', message: '' },
      state,
    ).status,
    'command',
  );
  assert.match(runCommand(state, 'interior angle').message, /120 degrees/);
  assert.deepEqual(
    runCommand(state, 'double shape').state.geometry!.dimensions,
    { sides: 6, side: 4 },
  );
  assert.deepEqual(
    runCommand(state, 'set sides to five').state.geometry!.dimensions,
    { sides: 5, side: 2 },
  );
});

test('AI graph numbering includes the primary curve before the additional curves', () => {
  assert.deepEqual(
    numberedGraphs({ expression: 'y=x^2', graphExpressions: ['y=2*x', 'y=3'] }),
    [
      { graph: 1, expression: 'y=x^2' },
      { graph: 2, expression: 'y=2*x' },
      { graph: 3, expression: 'y=3' },
    ],
  );
});

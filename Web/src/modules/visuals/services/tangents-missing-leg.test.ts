import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphTangent, graphFunction } from '../index.ts';
import { parseGeometry, geometryMeasures } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
} from '../../problems/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('analytic tangents meet the curve and have the exact polynomial slope', () => {
  for (const x of [-2, 0, 1, 3]) {
    const t = graphTangent('y=2*x^2-3*x+5', x);
    assert.equal(t.slope, 4 * x - 3);
    assert.equal(graphFunction(t.equation).value(x), t.y);
    assert.ok(
      Math.abs(graphFunction(t.equation).value(x + 1)! - t.y - t.slope) < 1e-10,
    );
  }
  assert.equal(graphTangent('y=(x-2)^2+3', 2).slope, 0);
  assert.equal(graphTangent('y=7', 4).equation, 'y = 7');
  for (const expression of ['sin(x)', '1/x', 'x^3'])
    assert.throws(() => graphTangent(expression, 1), /linear and quadratic/);
  assert.throws(() => graphTangent('x^2', Infinity), /finite/);
});
test('adding a tangent is one recoverable step and reading slope preserves work', () => {
  let book = createProblemLibrary();
  for (const command of ['graph y=x^2', 'add tangent to graph 1 at x 2']) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, r.storedCommand || command);
  }
  const state = currentProblem(book).state;
  assert.equal(state.expression, 'y = x^2');
  assert.equal(graphFunction(state.graphExpressions![0]).value(3), 8);
  assert.equal(
    currentProblem(undoStep(book)).state.graphExpressions?.length || 0,
    0,
  );
  assert.deepEqual(currentProblem(redoStep(undoStep(book))).state, state);
  const read = runCommand(state, 'slope of graph 1 at x two');
  assert.match(read.message, /slope: 4/);
  assert.equal(read.changed, false);
  assert.deepEqual(read.state, state);
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'slope of graph 1 at x 2', message: '' },
      state,
    ).status,
    'command',
  );
  assert.throws(
    () => runCommand(state, 'add tangent to graph 9 at x 2'),
    /does not exist/,
  );
});
test('right triangles from a hypotenuse and one leg derive a valid missing length', () => {
  const g = parseGeometry('right triangle hypotenuse thirteen leg five')!;
  assert.deepEqual(g.dimensions, { a: 5, b: 12 });
  assert.equal(geometryMeasures(g).area.value, 30);
  assert.equal(geometryMeasures(g).hypotenuse.value, 13);
  for (const input of [
    'right triangle hypotenuse 5 leg 5',
    'right triangle hypotenuse 4 leg 5',
    'right triangle hypotenuse -13 leg 5',
  ])
    assert.throws(() => parseGeometry(input), /hypotenuse must/);
  assert.throws(
    () => parseGeometry('right triangle hypotenuse 13'),
    /hypotenuse and/,
  );
  const state = runCommand(
    initialWorkspace,
    'right triangle hypotenuse 13 leg 5',
  ).state;
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'right triangle hypotenuse 13 leg 5',
        message: '',
      },
      initialWorkspace,
    ).status,
    'command',
  );
  assert.deepEqual(state.geometry!.dimensions, { a: 5, b: 12 });
});

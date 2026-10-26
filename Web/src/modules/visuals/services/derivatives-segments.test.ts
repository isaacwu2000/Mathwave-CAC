import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphDerivative, graphFunction, graphTangent } from '../index.ts';
import {
  circularSegmentArea,
  geometryMeasures,
  parseGeometry,
} from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { validateInterpretation } from '../../commands/index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
} from '../../problems/index.ts';
test('derivative curves equal analytic tangent slopes across the original function', () => {
  for (const expression of ['2*x^2-3*x+5', '(x-2)^2+3', '7*x+2', '9']) {
    const derivative = graphFunction(graphDerivative(expression));
    for (const x of [-3, 0, 0.125, 4])
      assert.equal(derivative.value(x), graphTangent(expression, x).slope);
  }
  assert.equal(graphFunction(graphDerivative('9')).value(100), 0);
  for (const expression of ['sin(x)', '1/x', 'x^3'])
    assert.throws(() => graphDerivative(expression), /linear and quadratic/);
});
test('derivative addition is a single recoverable step, while reading preserves state', () => {
  let book = createProblemLibrary();
  for (const command of ['graph y=x^2', 'add derivative of graph one']) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, r.storedCommand || command);
  }
  const state = currentProblem(book).state;
  assert.equal(graphFunction(state.graphExpressions![0]).value(3), 6);
  assert.equal(
    currentProblem(undoStep(book)).state.graphExpressions?.length || 0,
    0,
  );
  assert.deepEqual(currentProblem(redoStep(undoStep(book))).state, state);
  assert.deepEqual(runCommand(state, 'derivative of graph 1').state, state);
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'add derivative of graph one',
        message: '',
      },
      state,
    ).command,
    'add derivative of graph 1',
  );
  assert.throws(
    () => runCommand(state, 'add derivative of graph 9'),
    /does not exist/,
  );
});
test('circular segment areas distinguish minor, major, full and tiny segments', () => {
  const r = 5;
  assert.ok(
    Math.abs(circularSegmentArea(r, 180) - (Math.PI * r * r) / 2) < 1e-10,
  );
  assert.ok(Math.abs(circularSegmentArea(r, 360) - Math.PI * r * r) < 1e-10);
  assert.ok(
    Math.abs(
      circularSegmentArea(r, 90) +
        circularSegmentArea(r, 270) -
        Math.PI * r * r,
    ) < 1e-10,
  );
  const theta = (1e-8 * Math.PI) / 180;
  assert.ok(
    Math.abs(circularSegmentArea(r, 1e-8) / ((r * r * theta ** 3) / 12) - 1) <
      1e-12,
  );
  assert.throws(() => circularSegmentArea(r, 0), /positive dimensions/);
  const g = parseGeometry('sector radius 5 angle 60')!;
  const m = geometryMeasures(g);
  assert.ok(m['segment area'].value < m.area.value);
  const state = runCommand(initialWorkspace, 'sector radius 5 angle 60').state;
  assert.match(runCommand(state, 'segment area').message, /square units/);
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'segment area', message: '' },
      state,
    ).status,
    'command',
  );
});

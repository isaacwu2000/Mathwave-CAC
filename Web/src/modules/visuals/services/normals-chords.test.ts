import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphNormal, graphTangent, graphFunction } from '../index.ts';
import { geometryMeasures, parseGeometry } from '../index.ts';
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
test('normal passes through the selected point and is perpendicular to the tangent', () => {
  for (const [expression, x] of [
    ['x^2', 2],
    ['2*x+3', -1],
    ['-3*x^2+2*x', 4],
  ] as const) {
    const normal = graphNormal(expression, x),
      tangent = graphTangent(expression, x);
    assert.ok(Math.abs(normal.slope! * tangent.slope + 1) < 1e-12);
    assert.ok(
      Math.abs(graphFunction(normal.equation).value(x)! - normal.y) < 1e-10,
    );
  }
  assert.deepEqual(graphNormal('x^2', 0), {
    x: 0,
    y: 0,
    slope: null,
    equation: 'x = 0',
    vertical: true,
  });
  assert.throws(() => graphNormal('sin(x)', 1), /linear and quadratic/);
});
test('normal commands preserve recovery and never plot a vertical line as y=f(x)', () => {
  let book = createProblemLibrary();
  for (const command of ['graph y=x^2', 'add normal to graph one at x two']) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, r.storedCommand || command);
  }
  const state = currentProblem(book).state;
  assert.equal(graphFunction(state.graphExpressions![0]).value(2), 4);
  assert.equal(
    currentProblem(undoStep(book)).state.graphExpressions?.length || 0,
    0,
  );
  assert.deepEqual(currentProblem(redoStep(undoStep(book))).state, state);
  assert.match(
    runCommand(state, 'normal of graph 1 at x 0').message,
    /normal is vertical/,
  );
  assert.throws(
    () => runCommand(state, 'add normal to graph 1 at x 0'),
    /Vertical lines cannot/,
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'normal of graph one at x 2', message: '' },
      state,
    ).command,
    'normal of graph 1 at x 2',
  );
});
test('sector chords use degree angles and distinguish straight distances from arcs', () => {
  for (const [angle, expected] of [
    [60, 5],
    [90, 5 * Math.sqrt(2)],
    [180, 10],
    [270, 5 * Math.sqrt(2)],
    [360, 0],
  ]) {
    const metrics = geometryMeasures(
      parseGeometry(`sector radius 5 angle ${angle}`)!,
    );
    assert.ok(Math.abs(metrics['chord length'].value - expected) < 1e-10);
    assert.ok(metrics['arc length'].value >= metrics['chord length'].value);
  }
  const state = runCommand(initialWorkspace, 'sector radius 5 angle 60').state;
  assert.match(
    runCommand(state, 'chord length').message,
    /chord length: 5 units/,
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'chord length', message: '' },
      state,
    ).status,
    'command',
  );
});

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphValueTable } from '../index.ts';
import { geometryMeasures, scaleGeometry } from '../index.ts';
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
test('tables preserve exact coordinates, undefined values, and curve selection without edits', () => {
  assert.deepEqual(
    graphValueTable('y=x^2', { min: -2, max: 2 }),
    [-2, -1, 0, 1, 2].map((x) => ({ x, y: x * x })),
  );
  assert.equal(graphValueTable('1/x', { min: -2, max: 2 })[2].y, null);
  const state = runCommand(
    structuredClone(initialWorkspace),
    'graph y=x^2',
  ).state;
  const added = runCommand(state, 'add graph y=1/x').state;
  const result = runCommand(added, 'table graph 2');
  assert.match(result.message, /x 0: undefined/);
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, added);
  assert.throws(() => runCommand(state, 'table graph 9'), /does not exist/);
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'table graph 2', message: '' },
      added,
    ).status,
    'command',
  );
});
test('uniform scaling preserves similarity and area/volume ratios with recovery', () => {
  const sphere = { shape: 'sphere' as const, dimensions: { radius: 3 } };
  const doubled = scaleGeometry(sphere, 2);
  assert.equal(doubled.dimensions.radius, 6);
  assert.equal(
    geometryMeasures(doubled).volume.value /
      geometryMeasures(sphere).volume.value,
    8,
  );
  assert.equal(
    geometryMeasures(doubled)['surface area'].value /
      geometryMeasures(sphere)['surface area'].value,
    4,
  );
  assert.equal(sphere.dimensions.radius, 3);
  for (const factor of [0, -1, Infinity, NaN, 1e9])
    assert.throws(() => scaleGeometry(sphere, factor));
  let book = createProblemLibrary();
  for (const command of ['right triangle a 3 b 4', 'scale shape by 2']) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, r.storedCommand || command);
  }
  assert.deepEqual(currentProblem(book).state.geometry!.dimensions, {
    a: 6,
    b: 8,
  });
  assert.deepEqual(currentProblem(undoStep(book)).state.geometry!.dimensions, {
    a: 3,
    b: 4,
  });
  assert.deepEqual(
    currentProblem(redoStep(undoStep(book))).state.geometry!.dimensions,
    { a: 6, b: 8 },
  );
  assert.match(
    runCommand(currentProblem(book).state, 'halve shape').message,
    /Areas multiply by 0.25/,
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'scale shape by 2', message: '' },
      currentProblem(book).state,
    ).status,
    'command',
  );
});

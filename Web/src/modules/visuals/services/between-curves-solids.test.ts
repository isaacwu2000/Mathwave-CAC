import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphAreaBetween } from '../index.ts';
import { parseGeometry, geometryMeasures, scaleGeometry } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { validateInterpretation } from '../../commands/index.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
  decodeProblemLibrary,
} from '../../problems/index.ts';
test('area between curves splits at crossings and is independent of order', () => {
  assert.equal(graphAreaBetween('y=x', 'y=-x', -1, 1), 2);
  assert.equal(graphAreaBetween('y=x', 'y=x', -1, 1), 0);
  assert.ok(Math.abs(graphAreaBetween('y=x^2', 'y=1', -2, 2) - 4) < 1e-10);
  assert.equal(graphAreaBetween('y=2', 'y=5', 3, 1), 6);
  assert.equal(graphAreaBetween('y=5', 'y=2', 1, 3), 6);
  assert.throws(
    () => graphAreaBetween('1/x', '1/x', -1, 1),
    /linear and quadratic/,
  );
  const state = runCommand(
    runCommand(initialWorkspace, 'graph y=x').state,
    'add graph y=-x',
  ).state;
  const r = runCommand(state, 'area between graphs 1 and 2 from -1 to 1');
  assert.equal(r.changed, false);
  assert.deepEqual(r.state, state);
  assert.match(r.message, /: 2\./);
  assert.equal(
    runCommand(state, 'area between graph two and graph one from -1 to 1')
      .message,
    runCommand(state, 'area between graphs 2 and 1 from -1 to 1').message,
  );
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'area between graph two and graph one from -1 to 1',
        message: '',
      },
      state,
    ).command,
    'area between graphs 2 and 1 from -1 to 1',
  );
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'area between graphs 1 and 2 from -1 to 1',
        message: '',
      },
      state,
    ).status,
    'command',
  );
  assert.throws(
    () => runCommand(state, 'area between graphs 1 and 1 from -1 to 1'),
    /different/,
  );
});
test('solid metrics, scaling, and saved recovery preserve three dimensions', () => {
  const g = parseGeometry('rectangular prism length 4 width 3 height 12')!;
  const m = geometryMeasures(g);
  assert.equal(m.volume.value, 144);
  assert.equal(m['surface area'].value, 192);
  assert.equal(m['space diagonal'].value, 13);
  assert.equal(
    runCommand(
      { ...initialWorkspace, mode: 'geometry', geometry: g },
      'diagonal',
    ).message,
    runCommand(
      { ...initialWorkspace, mode: 'geometry', geometry: g },
      'space diagonal',
    ).message,
  );
  assert.equal(
    geometryMeasures(scaleGeometry(g, 2)).volume.value,
    8 * m.volume.value,
  );
  const cube = geometryMeasures(parseGeometry('cube side 3')!);
  assert.equal(cube.volume.value, 27);
  assert.equal(cube['surface area'].value, 54);
  assert.throws(
    () => parseGeometry('rectangular prism length 3 width 2'),
    /height/,
  );
  assert.throws(() => parseGeometry('cube side 0'), /positive/);
  let book = createProblemLibrary();
  for (const command of [
    'rectangular prism length 4 width 3 height 12',
    'set length to 8',
  ]) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, command);
  }
  assert.equal(
    currentProblem(undoStep(book)).state.geometry!.dimensions.length,
    4,
  );
  assert.deepEqual(
    currentProblem(redoStep(undoStep(book))).state,
    currentProblem(book).state,
  );
  assert.deepEqual(
    currentProblem(decodeProblemLibrary(JSON.stringify(book))).state,
    currentProblem(book).state,
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'space diagonal', message: '' },
      currentProblem(book).state,
    ).status,
    'command',
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'set length to 5', message: '' },
      currentProblem(book).state,
    ).status,
    'command',
  );
});

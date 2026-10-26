import { test } from 'vitest';
import assert from 'node:assert/strict';
import { transformGraph, graphFunction } from '../index.ts';
import {
  parseGeometry,
  geometryMeasures,
  scaleGeometry,
  describeGeometry,
} from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  undoStep,
  redoStep,
} from '../../problems/index.ts';
import { resolveClarification } from '../../commands/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('graph reflections and stretching preserve direction, domain, and recovery', () => {
  for (const expr of ['y=x+2', 'sin(x)', '1/x', 'y=x^2'])
    for (const [input, output] of [
      [-1, 1],
      [1, -1],
      [1, 0.5],
      [1, 3],
    ]) {
      for (const x of [-2, 0, 3]) {
        const before = graphFunction(expr).value(x * input);
        const actual = graphFunction(transformGraph(expr, input, output)).value(
          x,
        );
        const expected = before === null ? null : before * output;
        assert.equal(actual === 0 ? 0 : actual, expected === 0 ? 0 : expected);
      }
    }
  assert.throws(() => transformGraph('x=3', -1, 1), /implicit/);
  assert.throws(() => transformGraph('x', 1, 0), /nonzero/);
  let book = createProblemLibrary();
  for (const cmd of [
    'graph y=x+2',
    'reflect graph 1 across y axis',
    'scale graph 1 vertically by 3',
  ]) {
    const r = runCommand(currentProblem(book).state, cmd);
    book = recordStep(book, r.state, r.storedCommand || cmd);
  }
  const state = currentProblem(book).state;
  assert.equal(graphFunction(state.expression).value(3), -3);
  assert.deepEqual(currentProblem(redoStep(undoStep(book))).state, state);
  assert.throws(
    () => runCommand(state, 'scale graph 1 vertically by zero'),
    /positive/,
  );
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'reflect graph 1 across x axis',
        message: '',
      },
      state,
    ).status,
    'command',
  );
});
test('sector arc, area, and perimeter use degrees and preserve angle when scaling', () => {
  const quarter = parseGeometry('sector radius 4 angle ninety')!;
  const m = geometryMeasures(quarter);
  assert.ok(Math.abs(m['arc length'].value - 2 * Math.PI) < 1e-10);
  assert.ok(Math.abs(m.area.value - 4 * Math.PI) < 1e-10);
  assert.ok(Math.abs(m.perimeter.value - (8 + 2 * Math.PI)) < 1e-10);
  assert.match(describeGeometry(quarter), /90 degrees/);
  assert.deepEqual(scaleGeometry(quarter, 2).dimensions, {
    radius: 8,
    angle: 90,
  });
  const full = geometryMeasures(parseGeometry('sector radius 4 angle 360')!);
  assert.equal(full.perimeter.value, 8 * Math.PI);
  for (const angle of [0, -1, 361])
    assert.throws(() => parseGeometry(`sector radius 4 angle ${angle}`));
  assert.equal(
    resolveClarification(
      { request: 'sector radius four', question: 'What is the sector angle?' },
      'ninety',
    ),
    'sector radius four angle ninety',
  );
  const state = runCommand(initialWorkspace, 'sector radius 4 angle 90').state;
  assert.deepEqual(
    runCommand(state, 'set angle to 180').state.geometry!.dimensions,
    { radius: 4, angle: 180 },
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'arc length', message: '' },
      state,
    ).status,
    'command',
  );
});

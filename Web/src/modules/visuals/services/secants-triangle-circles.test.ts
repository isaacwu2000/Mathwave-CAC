import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  graphSecant,
  graphFunction,
  validateGraphComparison,
} from '../index.ts';
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

test('secant passes through both endpoints, including non-polynomial curves', () => {
  for (const [expression, start, end] of [
    ['x^2', -2, 3],
    ['sin(x)', 0, 1],
    ['1/x', -1, 1],
  ] as const) {
    const line = graphSecant(expression, start, end),
      value = graphFunction(line.equation).value;
    assert.ok(Math.abs(value(start)! - line.start.y) < 1e-12);
    assert.ok(Math.abs(value(end)! - line.end.y) < 1e-12);
    assert.equal(graphSecant(expression, end, start).rate, line.rate);
  }
  assert.throws(() => graphSecant('1/x', 0, 1), /undefined/);
  assert.throws(() => graphSecant('x^2', 1, 1), /distinct/);
  assert.throws(() => graphSecant('x^2', Infinity, 1), /finite/);
});

test('secants are one reversible step and support spoken graph numbers', () => {
  let book = createProblemLibrary();
  for (const command of [
    'graph y=x^2',
    'add secant to graph one from negative two to three',
  ]) {
    const r = runCommand(currentProblem(book).state, command);
    book = recordStep(book, r.state, r.storedCommand || command);
  }
  const saved = currentProblem(book).state;
  assert.equal(graphFunction(saved.graphExpressions![0]).value(0), 6);
  assert.deepEqual(saved.graphComparison, {
    expression: 'y = x^2',
    start: -2,
    end: 3,
  });
  assert.throws(() =>
    validateGraphComparison({ expression: '1/x', start: 0, end: 1 }),
  );
  assert.throws(() =>
    validateGraphComparison({ expression: 'x', start: 1, end: 1 }),
  );
  assert.equal(
    currentProblem(undoStep(book)).state.graphExpressions?.length || 0,
    0,
  );
  assert.deepEqual(currentProblem(redoStep(undoStep(book))).state, saved);
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'add secant to graph one from -2 to 3',
        message: '',
      },
      saved,
    ).command,
    'add secant to graph 1 from -2 to 3',
  );
  assert.throws(
    () => runCommand(saved, 'add secant to graph 9 from 0 to 1'),
    /does not exist/,
  );
  const full = { ...saved, graphExpressions: Array(7).fill('y=x') };
  assert.throws(
    () => runCommand(full, 'add secant to graph 1 from 0 to 1'),
    /eight|8/i,
  );
});

test('triangle circle radii and altitudes obey known geometric identities', () => {
  for (const command of ['triangle a 3 b 4 c 5', 'right triangle a 3 b 4']) {
    const state = runCommand(initialWorkspace, command).state;
    const m = geometryMeasures(state.geometry!);
    assert.equal(m.inradius.value, 1);
    assert.equal(m.circumradius.value, 2.5);
    assert.equal(m['altitude a'].value, 4);
    assert.equal(m['altitude b'].value, 3);
    assert.equal(m['altitude c'].value, 2.4);
    for (const metric of ['inradius', 'circumradius', 'altitude c']) {
      assert.deepEqual(
        runCommand(state, metric).state.geometry,
        state.geometry,
      );
      assert.equal(
        validateInterpretation(
          { status: 'command', command: metric, message: '' },
          state,
        ).status,
        'command',
      );
    }
  }
  const equilateral = geometryMeasures(parseGeometry('triangle a 2 b 2 c 2')!);
  assert.ok(
    Math.abs(equilateral.circumradius.value - 2 * equilateral.inradius.value) <
      1e-12,
  );
  assert.ok(Math.abs(equilateral['altitude a'].value - Math.sqrt(3)) < 1e-12);
  const baseOnly = runCommand(
    initialWorkspace,
    'triangle base 4 height 3',
  ).state;
  assert.throws(() => runCommand(baseOnly, 'inradius'), /three side lengths/);
  assert.equal(geometryMeasures(baseOnly.geometry!).inradius, undefined);
});

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fitGraphComparison } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { contentChanged } from '../../problems/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('comparison fitting contains offscreen, reversed and constant endpoints with safe bounds', () => {
  for (const comparison of [
    { expression: 'x^2', start: 20, end: 25 },
    { expression: '7', start: 25, end: 20 },
    { expression: 'x', start: -1e6, end: 1e6 },
  ]) {
    const view = fitGraphComparison(comparison);
    for (const v of [comparison.start, comparison.end])
      assert.ok(v >= view.x.min && v <= view.x.max);
    assert.ok(view.y.max > view.y.min);
    assert.ok(view.x.min >= -1e6 && view.x.max <= 1e6);
  }
  const view = fitGraphComparison({ expression: 'x^2', start: 20, end: 25 });
  assert.ok(view.y.min <= 400 && view.y.max >= 625);
  assert.throws(
    () => fitGraphComparison({ expression: 'x^2', start: 2000, end: 3000 }),
    /plot limit/,
  );
});
test('fit and hide preserve all graph work and reject stale references', () => {
  const base = runCommand(initialWorkspace, 'graph y=x^2').state;
  const compared = runCommand(
    base,
    'average rate of change of graph 1 from 20 to 25',
  ).state;
  const fitted = runCommand(compared, 'fit comparison').state;
  assert.equal(contentChanged(compared, fitted), false);
  assert.ok(fitted.graphRange!.min <= 20 && fitted.graphRange!.max >= 25);
  assert.ok(fitted.graphYRange!.min <= 400 && fitted.graphYRange!.max >= 625);
  const hidden = runCommand(fitted, 'hide comparison').state;
  assert.equal(hidden.graphComparison, undefined);
  assert.equal(contentChanged(fitted, hidden), false);
  assert.throws(
    () => runCommand(hidden, 'fit comparison'),
    /Compare two points/,
  );
  assert.throws(
    () => runCommand({ ...compared, expression: 'y=x' }, 'fit comparison'),
    /current graph/,
  );
  for (const command of ['fit comparison', 'hide comparison'])
    assert.equal(
      validateInterpretation(
        { status: 'command', command, message: '' },
        compared,
      ).status,
      'command',
    );
});
test('hiding triangle construction preserves shape and supports re-showing', () => {
  const base = runCommand(initialWorkspace, 'triangle a 3 b 4 c 5').state;
  const shown = runCommand(base, 'inradius').state;
  const hidden = runCommand(shown, 'hide construction').state;
  assert.equal(hidden.geometryOverlay, undefined);
  assert.equal(contentChanged(shown, hidden), false);
  assert.deepEqual(hidden.geometry, base.geometry);
  assert.equal(
    runCommand(hidden, 'circumradius').state.geometryOverlay,
    'circumradius',
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'hide construction', message: '' },
      shown,
    ).status,
    'command',
  );
});

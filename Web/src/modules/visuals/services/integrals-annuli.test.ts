import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphIntegral } from '../index.ts';
import { parseGeometry, geometryMeasures, scaleGeometry } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { resolveClarification } from '../../commands/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('analytic integrals distinguish signed cancellation from total area', () => {
  assert.equal(graphIntegral('y=x', -1, 1), 0);
  assert.equal(graphIntegral('y=x', -1, 1, true), 1);
  assert.ok(Math.abs(graphIntegral('y=x^2', 0, 3) - 9) < 1e-10);
  assert.ok(Math.abs(graphIntegral('y=x^2-1', -2, 2, true) - 4) < 1e-10);
  assert.equal(graphIntegral('y=2', 3, 1), -4);
  assert.equal(graphIntegral('y=2', 3, 1, true), 4);
  assert.equal(graphIntegral('y=x^2', 2, 2), 0);
  for (const expr of ['1/x', 'sin(x)', 'x^3'])
    assert.throws(() => graphIntegral(expr, -1, 1), /linear and quadratic/);
  assert.throws(() => graphIntegral('x', 0, Infinity), /finite/);
  const state = runCommand(initialWorkspace, 'graph y=x').state;
  const result = runCommand(state, 'integral graph 1 from -1 to 1');
  assert.equal(result.changed, false);
  assert.deepEqual(result.state, state);
  assert.match(result.message, /Signed definite integral/);
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'total area graph 1 from -1 to 1',
        message: '',
      },
      state,
    ).status,
    'command',
  );
});
test('annuli require ordered radii and count both boundary circumferences', () => {
  const g = parseGeometry('annulus outer radius five inner radius three')!;
  const m = geometryMeasures(g);
  assert.equal(m.area.value, 16 * Math.PI);
  assert.equal(m.perimeter.value, 16 * Math.PI);
  assert.equal(m.thickness.value, 2);
  assert.deepEqual(scaleGeometry(g, 2).dimensions, { outer: 10, inner: 6 });
  for (const text of [
    'annulus outer 3 inner 5',
    'annulus outer 3 inner 3',
    'annulus outer 3 inner -1',
  ])
    assert.throws(() => parseGeometry(text));
  assert.equal(
    resolveClarification(
      { request: 'annulus outer five', question: 'What is the annulus inner?' },
      'three',
    ),
    'annulus outer five inner three',
  );
  const state = runCommand(initialWorkspace, 'annulus outer 5 inner 3').state;
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'thickness', message: '' },
      state,
    ).status,
    'command',
  );
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'set inner to two', message: '' },
      state,
    ).status,
    'command',
  );
  assert.deepEqual(
    runCommand(state, 'set inner to two').state.geometry!.dimensions,
    { outer: 5, inner: 2 },
  );
});

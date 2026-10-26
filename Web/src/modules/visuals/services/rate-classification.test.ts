import { test } from 'vitest';
import assert from 'node:assert/strict';
import { contentChanged } from '../../problems/index.ts';
import { graphAverageRate } from '../index.ts';
import { classifyTriangle, geometryMeasures } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('secant rates preserve endpoints and direction without inventing continuity', () => {
  assert.equal(graphAverageRate('y=x^2', 1, 3).rate, 4);
  assert.equal(graphAverageRate('y=x^2', 3, 1).rate, 4);
  assert.equal(graphAverageRate('y=7', -2, 5).rate, 0);
  assert.equal(graphAverageRate('y=1/x', -1, 1).rate, 1);
  for (const pair of [
    [0, 0],
    [0, 1],
    [Infinity, 2],
    [1e7, 2],
  ])
    assert.throws(() =>
      graphAverageRate('y=1/x', ...(pair as [number, number])),
    );
  const state = runCommand(initialWorkspace, 'graph y=x^2').state;
  const answer = runCommand(
    state,
    'average rate of change of graph 1 from one to three',
  );
  assert.match(answer.message, /rate of change: 4/);
  assert.match(answer.message, /not a derivative/);
  assert.equal(contentChanged(state, answer.state), false);
  assert.deepEqual(answer.state.graphComparison, {
    expression: state.expression,
    start: 1,
    end: 3,
  });
  assert.equal(
    validateInterpretation(
      {
        status: 'command',
        command: 'average rate of change of graph 1 from 1 to 3',
        message: '',
      },
      state,
    ).status,
    'command',
  );
});
test('triangle classification uses all three sides and remains scale invariant', () => {
  for (const [sides, expected] of [
    [[3, 4, 5], 'Scalene right'],
    [[2, 2, 2], 'Equilateral acute'],
    [[3, 3, 5], 'Isosceles obtuse'],
    [[4, 5, 6], 'Scalene acute'],
  ] as const) {
    for (const scale of [0.001, 1, 100]) {
      const [a, b, c] = sides.map((s) => s * scale);
      assert.ok(
        classifyTriangle({
          shape: 'triangle',
          dimensions: { a, b, c },
        }).startsWith(expected),
      );
    }
  }
  assert.throws(
    () =>
      classifyTriangle({
        shape: 'triangle',
        dimensions: { base: 3, height: 4 },
      }),
    /three side lengths/,
  );
  assert.throws(
    () =>
      classifyTriangle({ shape: 'triangle', dimensions: { a: 1, b: 2, c: 3 } }),
    /cannot form/,
  );
  const right = {
    shape: 'right triangle' as const,
    dimensions: { a: 3, b: 4 },
  };
  assert.equal(geometryMeasures(right)['angle c'].value, 90);
  assert.ok(
    Math.abs(
      geometryMeasures(right)['angle a'].value +
        geometryMeasures(right)['angle b'].value +
        90 -
        180,
    ) < 1e-10,
  );
  const state = runCommand(initialWorkspace, 'right triangle a 3 b 4').state;
  assert.equal(runCommand(state, 'classify triangle').changed, false);
  assert.equal(
    validateInterpretation(
      { status: 'command', command: 'classify triangle', message: '' },
      state,
    ).status,
    'command',
  );
});

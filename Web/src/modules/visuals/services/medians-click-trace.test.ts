import { test } from 'vitest';
import assert from 'node:assert/strict';
import { graphTraceX } from '../index.ts';
import { triangleDiagram } from '../index.ts';
import { parseGeometry, geometryMeasures } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  contentChanged,
  createProblemLibrary,
  updateProblem,
  currentProblem,
  decodeProblemLibrary,
} from '../../problems/index.ts';
import { validateInterpretation } from '../../commands/index.ts';
test('medians meet side midpoints and centroid divides all medians in a 2:1 ratio', () => {
  for (const input of [
    'triangle a 3 b 4 c 5',
    'triangle a 2 b 3 c 4',
    'right triangle a 3 b 4',
  ]) {
    const g = parseGeometry(input)!,
      full = triangleDiagram(g, 'centroid')!,
      center = full.centroid!;
    assert.equal(full.medians.length, 3);
    for (const m of full.medians) {
      assert.ok(
        Math.abs(center.x - (m.start.x + 2 * m.midpoint.x) / 3) < 1e-10,
      );
      assert.ok(
        Math.abs(center.y - (m.start.y + 2 * m.midpoint.y) / 3) < 1e-10,
      );
      const length = Math.hypot(
        m.start.x - m.midpoint.x,
        m.start.y - m.midpoint.y,
      );
      assert.ok(
        Math.abs(length - geometryMeasures(g)[`median ${m.side}`].value) <
          1e-10,
      );
      const selected = triangleDiagram(g, `median ${m.side}` as 'median a')!;
      assert.equal(selected.medians.length, 1);
      assert.equal(selected.medians[0].side, m.side);
    }
  }
  assert.equal(
    geometryMeasures(parseGeometry('triangle a 3 b 4 c 5')!)['median c'].value,
    2.5,
  );
});
test('centroid and median requests save construction views without changing math', () => {
  const base = runCommand(initialWorkspace, 'triangle a 3 b 4 c 5').state;
  for (const command of ['show centroid', 'median a', 'median c']) {
    const r = runCommand(base, command);
    assert.equal(contentChanged(base, r.state), false);
    assert.equal(
      validateInterpretation({ status: 'command', command, message: '' }, base)
        .status,
      'command',
    );
    const book = updateProblem(createProblemLibrary(), (p) => ({
      ...p,
      state: r.state,
    }));
    assert.equal(
      currentProblem(decodeProblemLibrary(JSON.stringify(book))).state
        .geometryOverlay,
      r.state.geometryOverlay,
    );
  }
  const limited = runCommand(
    initialWorkspace,
    'triangle base 4 height 3',
  ).state;
  assert.throws(
    () => runCommand(limited, 'show centroid'),
    /three triangle side lengths/,
  );
  assert.throws(() => runCommand(limited, 'median a'), /three side lengths/);
});
test('plot clicks map exact x coordinates and ignore axis labels or nonfinite positions', () => {
  const range = { min: -10, max: 10 };
  assert.equal(graphTraceX({ x: 48, y: 20 }, range), -10);
  assert.equal(graphTraceX({ x: 580, y: 332 }, range), 10);
  assert.equal(graphTraceX({ x: 314, y: 176 }, range), 0);
  assert.equal(
    graphTraceX({ x: 314.125, y: 176 }, range),
    -10 + (266.125 / 532) * 20,
  );
  for (const point of [
    { x: 20, y: 176 },
    { x: 314, y: 350 },
    { x: Infinity, y: 20 },
    { x: 50, y: NaN },
  ])
    assert.equal(graphTraceX(point, range), undefined);
});

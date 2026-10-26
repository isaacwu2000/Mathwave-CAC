import { test } from 'vitest';
import assert from 'node:assert/strict';
import { triangleDiagram, validateTriangleOverlay } from '../index.ts';
import { parseGeometry } from '../index.ts';
import { runCommand } from '../../commands/index.ts';
import { initialWorkspace } from '../../workspace/state.ts';
import {
  contentChanged,
  createProblemLibrary,
  updateProblem,
  currentProblem,
  decodeProblemLibrary,
} from '../../problems/index.ts';
test('incircles touch every side and circumcircles pass through every vertex', () => {
  for (const shape of [
    'triangle a 3 b 4 c 5',
    'triangle a 2 b 3 c 4',
    'right triangle a 5 b 12',
    'triangle a 2 b 2 c 2',
  ]) {
    const g = parseGeometry(shape)!;
    for (const overlay of ['inradius', 'circumradius'] as const) {
      const diagram = triangleDiagram(g, overlay)!,
        { center, radius } = diagram.circle!;
      diagram.vertices.forEach((p, i) => {
        const q = diagram.vertices[(i + 1) % 3];
        const distance =
          overlay === 'circumradius'
            ? Math.hypot(p.x - center.x, p.y - center.y)
            : Math.abs(
                (q.x - p.x) * (p.y - center.y) - (p.x - center.x) * (q.y - p.y),
              ) / Math.hypot(q.x - p.x, q.y - p.y);
        assert.ok(Math.abs(distance - radius) < 1e-9);
      });
      const screen = diagram.project(center),
        r = radius * diagram.scale;
      assert.ok(
        screen.x - r >= 100 &&
          screen.x + r <= 500 &&
          screen.y - r >= 30 &&
          screen.y + r <= 210,
      );
    }
  }
});
test('all altitudes are perpendicular and match named-side lengths, including obtuse extensions', () => {
  let outside = false;
  for (const shape of [
    'triangle a 3 b 4 c 5',
    'triangle a 2 b 3 c 4',
    'right triangle a 3 b 4',
  ]) {
    for (const overlay of ['altitude a', 'altitude b', 'altitude c'] as const) {
      const diagram = triangleDiagram(parseGeometry(shape)!, overlay)!,
        a = diagram.altitude!;
      const dot =
        (a.start.x - a.foot.x) * (a.sideEnd.x - a.sideStart.x) +
        (a.start.y - a.foot.y) * (a.sideEnd.y - a.sideStart.y);
      assert.ok(Math.abs(dot) < 1e-9);
      assert.ok(
        Math.abs(
          Math.hypot(a.start.x - a.foot.x, a.start.y - a.foot.y) -
            diagram.value!,
        ) < 1e-9,
      );
      outside ||= a.outside;
    }
  }
  assert.ok(outside);
  assert.equal(
    triangleDiagram(parseGeometry('triangle base 4 height 3')!, 'inradius'),
    null,
  );
  assert.throws(() => validateTriangleOverlay('altitude z'));
});
test('spoken geometry measures save diagram view without creating math edits', () => {
  const state = runCommand(initialWorkspace, 'triangle a 3 b 4 c 5').state;
  const r = runCommand(state, 'find inradius');
  assert.equal(r.state.geometryOverlay, 'inradius');
  assert.equal(contentChanged(state, r.state), false);
  const book = updateProblem(createProblemLibrary(), (p) => ({
    ...p,
    state: r.state,
  }));
  assert.equal(
    currentProblem(decodeProblemLibrary(JSON.stringify(book))).state
      .geometryOverlay,
    'inradius',
  );
  assert.equal(currentProblem(book).steps.length, 0);
});

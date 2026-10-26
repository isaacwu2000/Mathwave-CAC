import { compileGraphScene, type GraphScene } from './graph-scene.ts';
import { validateGraphRange, type GraphRange } from './graph.ts';
import { graphColors } from './renderer-adapter.ts';
import type { GraphDocument, GraphResult, Plot } from '../types.ts';
type Vertex = { x: number; y: number; value: number };

/** Samples bounded 2D graphs into the existing canvas contract.
 * Implicit contours use triangles on a 64×64 grid and checked edge roots; inequalities clip their fills to those roots.
 * Curves use 512 segments and midpoint discontinuity checks. Sampling is approximate and may miss features below grid resolution.
 * Work is bounded across the whole scene; this function never changes saved work or calls a provider.
 */
export function graphSceneRenderData(
  scene: GraphScene,
  x: GraphRange,
  y: GraphRange,
) {
  validateGraphRange(x);
  validateGraphRange(y);
  const compiled = compileGraphScene(scene, 2_000_000),
    plots: Plot[] = [],
    labels: NonNullable<GraphResult['labels']> = [];
  let operations = 0;
  const sample = (row: number, px: number, py = 0, t = px) => {
    if (++operations > 500000)
      throw new Error(
        'This graph needs too many samples. Use fewer rows or simpler expressions.',
      );
    return compiled.sample(row, px, py, t);
  };
  compiled.rows.forEach((row, index) => {
    if (
      row.kind === 'variable' ||
      (row.kind === 'function' && row.args?.length !== 1)
    )
      return;
    const color = graphColors[index % graphColors.length],
      positions: number[] = [],
      fill: number[] = [];
    if (row.kind === 'point') {
      const point = compiled.point(index, 0);
      if (point && Math.max(Math.abs(point.x), Math.abs(point.y)) <= 1e8) {
        plots.push({
          id: `scene-${index}`,
          kind: 'point',
          color,
          positions: [point.x, point.y, 0],
        });
        if (scene.rows[index].name)
          labels.push({
            text: scene.rows[index].name!,
            position: [point.x, point.y, 0],
          });
      }
      return;
    }
    if (row.kind === 'implicit' || row.kind === 'inequality') {
      const n = 64,
        vertices: (Vertex | null)[][] = [];
      for (let j = 0; j <= n; j++) {
        const line: (Vertex | null)[] = [];
        for (let i = 0; i <= n; i++) {
          const px = x.min + ((x.max - x.min) * i) / n,
            py = y.min + ((y.max - y.min) * j) / n,
            value = sample(index, px, py);
          line.push(value === null ? null : { x: px, y: py, value });
        }
        vertices.push(line);
      }
      const inside = (p: Vertex) =>
        row.operator === '>' || row.operator === '>='
          ? p.value >= 0
          : p.value <= 0;
      const root = (a: Vertex, b: Vertex): Vertex | null => {
        if (a.value === 0) return a;
        if (b.value === 0) return b;
        if (Math.sign(a.value) === Math.sign(b.value)) return null;
        let low = a,
          high = b;
        for (let k = 0; k < 24; k++) {
          const px = (low.x + high.x) / 2,
            py = (low.y + high.y) / 2,
            v = sample(index, px, py);
          if (v === null) return null;
          const mid = { x: px, y: py, value: v };
          if (v === 0) return mid;
          if (Math.sign(v) === Math.sign(low.value)) low = mid;
          else high = mid;
        }
        const mid = {
          x: (low.x + high.x) / 2,
          y: (low.y + high.y) / 2,
          value: 0,
        };
        const residual = sample(index, mid.x, mid.y);
        // A pole changes sign without approaching zero and must never become a contour.
        return residual !== null &&
          Math.abs(residual) <=
            Math.max(Math.abs(a.value), Math.abs(b.value)) * 1e-5
          ? mid
          : null;
      };
      const triangle = (points: (Vertex | null)[]) => {
        if (points.some((p) => p === null)) return;
        const input = points as Vertex[];
        if (input.every((p) => p.value === 0)) {
          if (
            row.kind === 'inequality' &&
            compiled.contains(
              index,
              input.reduce((sum, p) => sum + p.x, 0) / 3,
              input.reduce((sum, p) => sum + p.y, 0) / 3,
            )
          )
            fill.push(...input.flatMap((p) => [p.x, p.y, 0]));
          return;
        }
        const cuts: Vertex[] = [];
        for (let k = 0; k < 3; k++) {
          const a = input[k],
            b = input[(k + 1) % 3];
          if (a.value === 0) cuts.push(a);
          else if (Math.sign(a.value) !== Math.sign(b.value)) {
            const p = root(a, b);
            if (p) cuts.push(p);
            else return;
          }
        }
        const unique = cuts.filter(
          (p, i) => !cuts.slice(0, i).some((q) => q.x === p.x && q.y === p.y),
        );
        if (unique.length === 2) {
          const [a, b] = unique;
          const strict = compiled.strict(
            index,
            (a.x + b.x) / 2,
            (a.y + b.y) / 2,
          );
          positions.push(
            a.x,
            a.y,
            0,
            strict ? a.x + (b.x - a.x) * 0.65 : b.x,
            strict ? a.y + (b.y - a.y) * 0.65 : b.y,
            0,
          );
        }
        if (row.kind !== 'inequality') return;
        const polygon: Vertex[] = [];
        for (let k = 0; k < 3; k++) {
          const a = input[k],
            b = input[(k + 1) % 3];
          if (inside(a)) polygon.push(a);
          if (inside(a) !== inside(b)) {
            const p = root(a, b);
            if (p) polygon.push(p);
            else return;
          }
        }
        for (let k = 1; k + 1 < polygon.length; k++)
          fill.push(
            ...[polygon[0], polygon[k], polygon[k + 1]].flatMap((p) => [
              p.x,
              p.y,
              0,
            ]),
          );
      };
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = vertices[j][i],
            b = vertices[j][i + 1],
            c = vertices[j + 1][i + 1],
            d = vertices[j + 1][i];
          triangle([a, b, c]);
          triangle([a, c, d]);
        }
    } else {
      const domain =
        row.kind === 'polar' || row.kind === 'parametric'
          ? (scene.rows[index].domain ?? { min: 0, max: 2 * Math.PI })
          : row.kind === 'horizontal'
            ? y
            : x;
      const point = (t: number) => {
        if (++operations > 500000)
          throw new Error('This graph needs too many samples.');
        const p = compiled.point(index, t);
        return p && Math.max(Math.abs(p.x), Math.abs(p.y)) <= 1e8 ? p : null;
      };
      for (let i = 1; i <= 512; i++) {
        const ta = domain.min + ((domain.max - domain.min) * (i - 1)) / 512,
          tb = domain.min + ((domain.max - domain.min) * i) / 512;
        const a = point(ta),
          b = point(tb),
          m = point((ta + tb) / 2);
        if (!a || !b || !m) continue;
        const error = Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2);
        if (
          error > Math.max((y.max - y.min) * 0.01, Math.hypot(m.x, m.y) * 0.3)
        )
          continue;
        positions.push(a.x, a.y, 0, b.x, b.y, 0);
      }
    }
    if (fill.length)
      plots.push({
        id: `scene-fill-${index}`,
        kind: 'surface',
        color,
        opacity: 0.14,
        positions: fill,
      });
    plots.push({ id: `scene-${index}`, kind: 'line', color, positions });
    if (scene.rows[index].name && positions.length)
      labels.push({
        text: scene.rows[index].name!,
        position: [positions[0], positions[1], 0],
      });
  });
  const document: GraphDocument = {
    dimension: 2,
    angleMode: 'radians',
    expressions: [],
    bounds: { ...x, y },
  };
  const result: GraphResult = {
    plots,
    labels,
    errors: {},
    values: {},
    parameters: [],
  };
  // Canvas value labels are strings; computed values stay numbers in the command engine.
  result.values = Object.fromEntries(
    [...compiled.constants].map(([name, value]) => [name, String(value)]),
  );
  return { document, result };
}

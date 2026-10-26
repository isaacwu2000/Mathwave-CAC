import { expect, test } from 'vitest';
import { graphSceneRenderData } from './graph-scene-renderer.ts';
const range = { min: -3, max: 3 };

test('compound tautologies fill the plane while strict contradictions stay empty', () => {
  const render = (expression: string) =>
    graphSceneRenderData({ rows: [{ expression }] }, range, range).result.plots;
  expect(
    render('x<=x and y<=y').some(
      (p) => p.kind === 'surface' && p.positions.length > 0,
    ),
  ).toBe(true);
  expect(render('x<x and y<=y').flatMap((p) => p.positions)).toEqual([]);
});

test('an implicit circle is sampled around its center, not as a residual function', () => {
  const { result } = graphSceneRenderData(
    { rows: [{ expression: 'x^2+y^2=4' }] },
    range,
    range,
  );
  const positions = result.plots[0].positions;
  expect(positions.length).toBeGreaterThan(100);
  for (let i = 0; i < positions.length; i += 3)
    expect(positions[i] ** 2 + positions[i + 1] ** 2).toBeCloseTo(4, 3);
});

test('inequality fill stays on the satisfying side and poles never become implicit contours', () => {
  const result = graphSceneRenderData(
    { rows: [{ expression: 'y<x' }] },
    range,
    range,
  ).result;
  const fill = result.plots.find((p) => p.kind === 'surface')!.positions;
  for (let i = 0; i < fill.length; i += 3)
    expect(fill[i + 1]).toBeLessThanOrEqual(fill[i] + 1e-6);
  expect(
    graphSceneRenderData(
      { rows: [{ expression: '1/x=0' }] },
      range,
      range,
    ).result.plots.flatMap((p) => p.positions),
  ).toEqual([]);
});

test('parametric bounds and piecewise gaps are not joined with invented line segments', () => {
  const scene = {
    rows: [
      { expression: '(t,t^2)', domain: { min: 0, max: 1 } },
      { expression: 'y={x<0:0,x>=0:2}' },
    ],
  };
  const { result } = graphSceneRenderData(scene, range, range);
  const parabola = result.plots[0].positions;
  for (let i = 0; i < parabola.length; i += 3) {
    expect(parabola[i]).toBeGreaterThanOrEqual(0);
    expect(parabola[i]).toBeLessThanOrEqual(1);
    expect(parabola[i + 1]).toBeCloseTo(parabola[i] ** 2);
  }
  const piecewise = result.plots[1].positions;
  for (let i = 0; i < piecewise.length; i += 6)
    expect(piecewise[i + 1]).toBe(piecewise[i + 4]);
});

test('constant coordinate pairs render as visible points on the curve', () => {
  const { result } = graphSceneRenderData(
    {
      rows: [
        { expression: '(x+1)*(x+2)' },
        { expression: '(-1,0)' },
        { expression: '(-2,0)' },
      ],
    },
    range,
    range,
  );
  expect(
    result.plots.filter((p) => p.kind === 'point').map((p) => p.positions),
  ).toEqual([
    [-1, 0, 0],
    [-2, 0, 0],
  ]);
});

test('point rows keep scalar definitions, names and restrictions without hiding parametric curves', () => {
  const { result } = graphSceneRenderData(
    {
      rows: [
        { expression: 'a=-2' },
        { expression: '(a,0)', name: 'Root' },
        { expression: '(1,2){1<0}' },
        { expression: '(t,t^2)', domain: { min: -1, max: 1 } },
      ],
    },
    range,
    range,
  );
  expect(
    result.plots.filter((p) => p.kind === 'point').map((p) => p.positions),
  ).toEqual([[-2, 0, 0]]);
  expect(result.labels).toEqual([{ text: 'Root', position: [-2, 0, 0] }]);
  expect(
    result.plots.find((p) => p.kind === 'line')?.positions.length,
  ).toBeGreaterThan(100);
});

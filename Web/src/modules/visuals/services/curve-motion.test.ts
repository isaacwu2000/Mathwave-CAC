import { expect, test } from 'vitest';
import { curveMotionKey, interpolateCurves } from './curve-motion.ts';
import { graphRenderData } from './renderer-adapter.ts';
const range = { min: -10, max: 10 };
test('allows only explicit low degree polynomials and affine sine curves', () => {
  for (const source of ['x', 'x^2+5*x+2', '(x+2)*(x+1)', '2*sin(3*x+1)+4'])
    expect(curveMotionKey([source])).toBeDefined();
  for (const source of [
    '1/x',
    'sqrt(x)',
    'x^3',
    'sin(x^2)',
    'x*sin(x)',
    'x=y^2',
  ])
    expect(curveMotionKey([source])).toBeUndefined();
  expect(curveMotionKey(['x', 'sin(x)'])).toBeUndefined();
});
test('interpolates matching curve samples without joining gaps or different x coordinates', () => {
  const a = graphRenderData(['x^2+5*x+2'], range, range).result;
  const b = graphRenderData(['x^2+3*x+2'], range, range).result;
  const middle = interpolateCurves(a, b, 0.5)!;
  // At x=1, halfway between y=8 and y=6 is y=7.
  const p = middle.plots[0].positions;
  const i = p.findIndex((x, i) => i % 3 === 0 && Math.abs(x - 1) < 1e-9);
  expect(p[i + 1]).toBeCloseTo(7);
  const changedRange = graphRenderData(
    ['x^2+3*x+2'],
    { min: -5, max: 3 },
    range,
  ).result;
  expect(interpolateCurves(a, changedRange, 0.5)).toBeNull();
});

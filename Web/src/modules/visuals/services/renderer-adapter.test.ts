import { expect, test } from 'vitest';
import {
  graphRenderData,
  geometryRenderData,
  parseGeometry,
} from '../index.ts';

test('the canvas receives Math Audio curve samples and never joins a reciprocal across its pole', () => {
  const data = graphRenderData(
    ['1/x'],
    { min: -1, max: 1 },
    { min: -5, max: 5 },
  );
  const line = data.result.plots[0];
  for (let i = 0; i < line.positions.length; i += 6)
    expect(line.positions[i] * line.positions[i + 3]).toBeGreaterThan(0);
  expect(data.document.bounds.y).toEqual({ min: -5, max: 5 });
});

test('a 3-4-5 triangle keeps its calculated incircle and altitude in the new renderer', () => {
  const geometry = parseGeometry('right triangle a 3 b 4')!;
  const data = geometryRenderData(geometry, 'inradius');
  expect(data.result.labels?.some((p) => p.text.includes('inradius'))).toBe(
    true,
  );
  const circle = data.result.plots.find((p) => p.id === 'overlay-circle')!;
  expect(circle.positions[0]).toBeCloseTo(2);
  expect(circle.positions[1]).toBeCloseTo(1);
  expect(
    geometryRenderData(geometry, 'altitude c').result.plots.some(
      (p) => p.id === 'altitude',
    ),
  ).toBe(true);
});

test('dimension-based triangle drawings display deterministic side lengths', () => {
  const labels = geometryRenderData(parseGeometry('right triangle a 3 b 4')!)
    .result.labels!;
  expect(labels.map((label) => label.text)).toEqual(
    expect.arrayContaining(['3', '4', '5']),
  );
});

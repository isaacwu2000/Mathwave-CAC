import { expect, test } from 'vitest';
import {
  chosenCircle,
  oneNumberToFive,
  divideByCoefficient,
  panDown,
} from './autonomous-oracles.ts';
import { initialWorkspace } from '../../Web/src/modules/workspace/state.ts';
test('assumption oracles reject unrelated shapes, edits, operations and viewport directions', () => {
  expect(
    chosenCircle({
      ...initialWorkspace,
      mode: 'geometry',
      geometry: { shape: 'square', dimensions: { side: 2 } },
    }),
  ).toBe(false);
  expect(
    chosenCircle({
      ...initialWorkspace,
      mode: 'geometry',
      geometry: { shape: 'circle', dimensions: { radius: 2 } },
    }),
  ).toBe(true);
  const before = { ...initialWorkspace, expression: '2 * x + 3 = 9' };
  expect(
    oneNumberToFive(before, { ...before, expression: '5 * x + 3 = 9' }),
  ).toBe(true);
  expect(
    oneNumberToFive(before, { ...before, expression: '5 * x + 5 = 9' }),
  ).toBe(false);
  expect(
    oneNumberToFive(before, {
      ...before,
      expression: '5 * x + 3 = 9',
      data: [5],
    }),
  ).toBe(false);
  const division = { ...initialWorkspace, expression: '2 * x = 8' };
  expect(
    divideByCoefficient(division, {
      ...division,
      expression: '2 * x / 2 = 8 / 2',
    }),
  ).toBe(true);
  expect(
    divideByCoefficient(division, {
      ...division,
      expression: '2 * x + 2 = 8 + 2',
    }),
  ).toBe(false);
  const graph = { ...initialWorkspace, graph: true };
  expect(
    panDown(graph, {
      ...graph,
      graphRange: { min: -10, max: 10 },
      graphYRange: { min: -15, max: 5 },
    }),
  ).toBe(true);
  expect(
    panDown(graph, {
      ...graph,
      graphRange: { min: -10, max: 10 },
      graphYRange: { min: -5, max: 15 },
    }),
  ).toBe(false);
});

test('graph oracles reject wrong curves and a correct label on the wrong segment', async () => {
  const { expectedGraphCurves, expectedSegment } =
    await import('./autonomous-oracles.ts');
  expect(
    expectedGraphCurves(
      {
        ...initialWorkspace,
        graph: true,
        expression: 'x^2',
        graphExpressions: ['x+1'],
      },
      2,
    ),
  ).toBe(true);
  expect(
    expectedGraphCurves(
      {
        ...initialWorkspace,
        graph: true,
        expression: 'x^2',
        graphExpressions: ['x+2'],
      },
      2,
    ),
  ).toBe(false);
  expect(
    expectedGraphCurves(
      { ...initialWorkspace, graph: true, expression: 'x^2' },
      1,
    ),
  ).toBe(true);
  const shape = (source: string) => ({
    ...initialWorkspace,
    mode: 'geometry' as const,
    construction: source,
  });
  expect(
    expectedSegment(
      shape(
        'A=point(0,0)\nB=point(3,4)\ndraw segment(A,B)\nmeasure segment(A,B)',
      ),
    ),
  ).toBe(true);
  expect(
    expectedSegment(
      shape(
        'A=point(1,1)\nB=point(4,5)\ndraw segment(A,B)\nmeasure segment(A,B)',
      ),
    ),
  ).toBe(false);
});

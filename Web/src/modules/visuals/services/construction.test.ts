import { expect, test } from 'vitest';
import { constructionRenderData } from './construction-renderer.ts';

test('construction rendering preserves named vertices, side lengths, circles and rays', () => {
  const source =
    'A=point(0,0)\nB=point(4,0)\nC=point(0,3)\nI=incenter(A,B,C)\ndraw triangle(A,B,C),incircle(A,B,C),ray(A,B)\nmeasure segment(B,C)\nrightangle B,A,C';
  const { document, result } = constructionRenderData(source);
  expect(document.presentation?.preset).toBe('geometry');
  expect(result.labels?.map((v) => v.text)).toEqual(
    expect.arrayContaining(['A', 'B', 'C', '5']),
  );
  expect(result.plots.every((p) => p.positions.every(Number.isFinite))).toBe(
    true,
  );
  const circle = result.plots.find((p) => p.id === 'object-1');
  expect(circle?.positions.slice(0, 3)).toEqual([2, 1, 0]);
  expect(() => constructionRenderData(source + '\nassert equal(1,2)')).toThrow(
    /Assertion/,
  );
});

test('an angle-only preview has finite bounds', () => {
  const { document, result } = constructionRenderData(
    'A=point(1,0)\nB=point(0,0)\nC=point(0,1)\nangle A,B,C',
  );
  expect(
    [
      document.bounds.min,
      document.bounds.max,
      document.bounds.y?.min,
      document.bounds.y?.max,
    ].every(Number.isFinite),
  ).toBe(true);
  expect(result.labels?.map((v) => v.text)).toContain('90°');
});

test('inline and intermediate geometry cannot bypass coordinate or radius bounds', () => {
  for (const source of [
    'draw point(2000000,0)',
    'draw circle(point(0,0),2000000)',
    'A=point(2000000,0)\ndraw A',
    'assert equal(distance(point(2000000,0),point(0,0)),2000000)\ndraw point(0,0)',
  ])
    expect(() => constructionRenderData(source)).toThrow(/million/);
});

test('explicit finite-segment measurements recompute after endpoint edits', () => {
  const source = 'A=point(0,0)\nB=point(3,4)\ndraw segment(A,B),line(A,B)\nmeasure segment(A,B)';
  const labels = constructionRenderData(source).result.labels!;
  expect(labels.filter((label) => label.text === '5')).toHaveLength(1);
  expect(
    constructionRenderData(
      source.replace('point(3,4)', 'point(0,6)'),
    ).result.labels!.some((label) => label.text === '6'),
  ).toBe(true);
  const triangle = constructionRenderData(
    'A=point(0,0)\nB=point(3,0)\nC=point(0,4)\ndraw triangle(A,B,C)\nmeasure segment(A,B)\nmeasure segment(A,C)\nmeasure segment(B,C)',
  );
  expect(triangle.result.labels!.map((label) => label.text)).toEqual(
    expect.arrayContaining(['3', '4', '5']),
  );
});

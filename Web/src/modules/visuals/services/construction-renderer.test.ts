import { expect, test } from 'vitest';
import { constructionRenderData } from './construction-renderer.ts';

const triangle =
  'A=point(0,0)\nB=point(3,0)\nC=point(0,4)\ndraw triangle(A,B,C)\nrightangle B,A,C';

test('a right-angle marker is drawn without measuring its decorative strokes', () => {
  const { result } = constructionRenderData(
    `${triangle}\nmeasure segment(A,B)\nmeasure segment(A,C)\nmeasure segment(B,C)`,
  );
  expect(result.labels?.map((label) => label.text).sort()).toEqual([
    '3',
    '4',
    '5',
    'A',
    'B',
    'C',
  ]);
  expect(result.plots.filter((plot) => plot.kind === 'line')).toHaveLength(3);
});

test('a symbolic hypotenuse replaces its automatic answer without defining the unknown', () => {
  const { result } = constructionRenderData(
    `${triangle}\nmeasure segment(A,B)\nmeasure segment(A,C)\nlabel segment(C,B), h`,
  );
  expect(result.labels?.map((label) => label.text).sort()).toEqual([
    '3',
    '4',
    'A',
    'B',
    'C',
    'h',
  ]);
  expect(result.labels?.find((label) => label.text === 'h')?.position).toEqual([
    1.5, 2, 0,
  ]);
});

test('the renderer never adds side lengths that the author omitted', () => {
  const { result } = constructionRenderData(triangle);
  expect(result.labels?.map((label) => label.text).sort()).toEqual([
    'A',
    'B',
    'C',
  ]);
});

test('construction defaults use warm stroke and peach fill colors', () => {
  const plots = constructionRenderData(triangle).result.plots;
  expect(
    plots
      .filter((plot) => plot.kind === 'line')
      .every((plot) => plot.color === '#b51d15'),
  ).toBe(true);
  expect(plots.find((plot) => plot.kind === 'surface')?.color).toBe('#f5bc98');
});

test('symbolic side labels reject non-segments and malformed labels', () => {
  for (const label of ['label A, h', 'label segment(A,A), h', 'label segment(A,B), 5', 'label segment(A,B), h=5'])
    expect(() => constructionRenderData(`${triangle}\n${label}`)).toThrow();
});

import { expect, test } from 'vitest';
import { selectCases } from './case-selection.ts';

test('seeded sampling covers every filtered category without duplicate families', () => {
  const cases = [
    { id: 'a1', category: 'algebra' },
    { id: 'a2', category: 'algebra' },
    { id: 'g1', category: 'geometry' },
    { id: 'g2', category: 'geometry' },
    { id: 's1', category: 'statistics' },
  ];
  const options = {
    categories: ['algebra', 'geometry'],
    sample: 2,
    seed: 'review-1',
  };
  const selected = selectCases(cases, options);
  expect(selected).toEqual(selectCases(cases, options));
  expect(selected).toHaveLength(2);
  expect(new Set(selected.map((c) => c.category))).toEqual(
    new Set(['algebra', 'geometry']),
  );
  expect(new Set(selected.map((c) => c.id)).size).toBe(2);
  expect(() => selectCases(cases, { sample: 2, seed: 'x' })).toThrow(
    /category/,
  );
  expect(() => selectCases(cases, { categories: ['typo'] })).toThrow(/Unknown/);
});

test('sampling redistributes exhausted categories and keeps a workflow as one unit', () => {
  const cases = [
    {
      id: 'conversation',
      category: 'conversation',
      turns: ['write', 'explain', 'accept', 'correct'],
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      category: 'algebra',
      turns: ['write'],
    })),
  ];
  const selected = selectCases(cases, { sample: 5, seed: 'balanced' });
  expect(selected).toHaveLength(5);
  expect(selected.find((c) => c.id === 'conversation')?.turns).toHaveLength(4);
  expect(new Set(selected.map((c) => c.id)).size).toBe(5);
  expect(selectCases(cases, { cases: ['conversation'] })).toEqual([cases[0]]);
  expect(() =>
    selectCases(cases, { cases: ['conversation', 'conversation'] }),
  ).toThrow();
  expect(() =>
    selectCases(cases, { cases: ['conversation'], categories: ['algebra'] }),
  ).toThrow();
  expect(() => selectCases(cases, { sample: 7, seed: 'x' })).toThrow();
  expect(() => selectCases(cases, { sample: 3 })).toThrow(/seed/);
  const choices = new Set(
    Array.from({ length: 20 }, (_, i) =>
      JSON.stringify(
        selectCases(cases, { sample: 2, seed: String(i) }).map((c) => c.id),
      ),
    ),
  );
  expect(choices.size).toBeGreaterThan(2);
});

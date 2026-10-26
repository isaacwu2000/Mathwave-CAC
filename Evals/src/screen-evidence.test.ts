import { expect, test } from 'vitest';
import { blankWorkspace } from '../../Web/src/modules/problems/index.ts';
import { screenMatchesWork } from './screen-evidence.ts';

test('a blank problem shows its empty state while saved equations must appear on screen', () => {
  const screen = {
    visible: true,
    text: 'What math shall we play with today?',
    mathLabels: [],
  };
  expect(screenMatchesWork(blankWorkspace(), 0, screen)).toBe(true);
  expect(
    screenMatchesWork({ ...blankWorkspace(), expression: 'x=4' }, 1, screen),
  ).toBe(false);
  expect(
    screenMatchesWork({ ...blankWorkspace(), expression: 'x=4' }, 1, {
      ...screen,
      mathLabels: ['x equals 4'],
    }),
  ).toBe(true);
});

test('graph screen evidence must contain each saved expression', () => {
  const state = {
    ...blankWorkspace(),
    graph: true,
    graphScene: { rows: [{ expression: 'y=x^2' }, { expression: 'y=4' }] },
  };
  const screen = { visible: true, text: 'Graph', mathLabels: [] };
  expect(screenMatchesWork(state, 1, screen)).toBe(false);
  expect(
    screenMatchesWork(state, 1, {
      ...screen,
      graphExpressions: ['y = x^2', 'y=4'],
    }),
  ).toBe(true);
  expect(
    screenMatchesWork(state, 1, {
      ...screen,
      graphExpressions: ['y = x^2', 'y=5'],
    }),
  ).toBe(false);
});

test('a visible geometry canvas counts when its positioned parent has no layout height', async () => {
  const state = {
    ...blankWorkspace(),
    mode: 'geometry' as const,
    geometry: { shape: 'right triangle' as const, dimensions: { a: 3, b: 4 } },
  };
  const workspace = {
    innerText: async () =>
      'Right triangle. leg a 3, leg b 4. All lengths use the same unit.',
    isVisible: async () => false,
    locator: () => ({ evaluateAll: async () => [], count: async () => 1 }),
  };
  const page = {
    screenshot: async () => {},
    getByLabel: () => workspace,
  } as unknown as import('playwright').Page;
  const { captureScreenEvidence } = await import('./screen-evidence.ts');
  const result = await captureScreenEvidence(
    page,
    '/tmp/mathwave-screen-oracle-test',
    'geometry',
    state,
    1,
  );
  expect(result.matchesSavedWork).toBe(true);
});

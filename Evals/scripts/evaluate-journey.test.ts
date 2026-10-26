import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

const run = (...args: string[]) =>
  execFileSync(
    process.execPath,
    ['--import', 'tsx', '../Evals/scripts/evaluate-journey.ts', 'suite', ...args, '--dry-run'],
    {
      encoding: 'utf8',
      env: { ...process.env, RUN_LIVE_CHECK: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
test('voice campaign dry-run deterministically filters cases without provider access', () => {
  const args = [
    '--categories',
    'algebra,graphs',
    '--sample',
    '2',
    '--seed',
    'cli-check',
  ];
  const plan = JSON.parse(run(...args));
  expect(plan).toEqual(JSON.parse(run(...args)));
  expect(plan.plannedTurns).toBe(2);
  expect(
    new Set(plan.selected.map((c: { category: string }) => c.category)),
  ).toEqual(new Set(['algebra', 'graphs']));
});
test('conversation dry-run includes its four dependent turns', () => {
  expect(JSON.parse(run('--cases', 'natural-conversation')).plannedTurns).toBe(
    4,
  );
});
test.each([
  ['--categories', 'typo'],
  ['--sample', '2'],
  ['--sample'],
  ['--typo', 'value'],
])('voice campaign dry-run rejects invalid arguments %j', (...args) => {
  expect(() => run(...args)).toThrow();
});

import { expect, test } from 'vitest';
import { summarizePairedLatency } from './paired-latency.ts';

test('speed comparison matches successful trials and excludes warm-ups and incomplete results', () => {
  const samples = [
    {
      variant: 'before',
      trial: 1,
      scenario: 'a',
      passed: true,
      displayMs: 1000,
    },
    { variant: 'after', trial: 1, scenario: 'a', passed: true, displayMs: 800 },
    {
      variant: 'before',
      trial: 2,
      scenario: 'a',
      passed: true,
      displayMs: 2000,
    },
    {
      variant: 'after',
      trial: 2,
      scenario: 'a',
      passed: false,
      displayMs: 100,
    },
    {
      variant: 'before',
      trial: 0,
      scenario: 'a',
      passed: true,
      warmup: true,
      displayMs: 9000,
    },
    {
      variant: 'before',
      trial: 3,
      scenario: 'a',
      passed: true,
      displayMs: 3000,
    },
  ];
  const result = summarizePairedLatency(samples);
  expect(result.before).toMatchObject({ attempted: 3, passed: 3, p50Ms: 2000 });
  expect(result.after).toMatchObject({ attempted: 2, passed: 1, p50Ms: 800 });
  expect(result.paired).toMatchObject({
    count: 1,
    faster: 1,
    medianSavedMs: 200,
    medianPercentFaster: 20,
  });
});

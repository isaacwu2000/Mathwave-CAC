import { expect, test } from 'vitest';
import { summarizeJourneys } from './journey-evaluation.ts';

test('latency summaries keep failures and missing stages separate from successful timings', () => {
  const result = summarizeJourneys([
    {
      passed: true,
      elapsedMs: 100,
      timings: [{ stage: 'model_1', duration: 70 }],
    },
    { passed: false, elapsedMs: 45000, timings: [] },
    {
      passed: true,
      elapsedMs: 300,
      timings: [{ stage: 'model_1', duration: 120 }],
    },
  ]);
  expect(result).toEqual({
    successInterval80: expect.objectContaining({ confidence: 0.8 }),
    attempted: 3,
    passed: 2,
    failed: 1,
    successMs: { p50: 100, p95: 300 },
    failureMs: { p50: 45000, p95: 45000 },
    stages: { model_1: { observed: 2, missing: 1, p50: 70, p95: 120 } },
  });
});

test('repeated preview display milestones contribute only the first display per journey', () => {
  const result = summarizeJourneys([
    {
      passed: true,
      elapsedMs: 400,
      timings: [
        { stage: 'display-commit', duration: 200 },
        { stage: 'display-commit', duration: 400 },
      ],
    },
  ]);
  expect(result.stages['display-commit']).toEqual({
    observed: 1,
    missing: 0,
    p50: 200,
    p95: 200,
  });
});

test('80% Wilson intervals retain uncertainty even for five successes or five failures', () => {
  const samples = (passed: boolean) =>
    Array.from({ length: 5 }, () => ({ passed, elapsedMs: 100, timings: [] }));
  expect(summarizeJourneys(samples(true)).successInterval80).toEqual({
    confidence: 0.8,
    lower: expect.closeTo(0.7527428728793251, 5),
    upper: 1,
  });
  expect(summarizeJourneys(samples(false)).successInterval80).toEqual({
    confidence: 0.8,
    lower: 0,
    upper: expect.closeTo(0.24725712712067488, 5),
  });
  expect(summarizeJourneys([]).successInterval80).toBeNull();
});

test('mixed success Wilson limits match an independently calculated 4/5 result', () => {
  const result = summarizeJourneys(
    Array.from({ length: 5 }, (_, i) => ({
      passed: i < 4,
      elapsedMs: 100,
      timings: [],
    })),
  );
  expect(result.successInterval80?.lower).toBeCloseTo(0.5135414727563554, 10);
  expect(result.successInterval80?.upper).toBeCloseTo(0.9381042509712396, 10);
});

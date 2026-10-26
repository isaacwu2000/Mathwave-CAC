import { expect, test } from 'vitest';
import {
  inputToDisplayLatency,
  summarizeCampaign,
} from './campaign-summary.ts';

test('correctness is independent of speed and missing latency is never zero', () => {
  const samples = [
    { passed: true, responseLatencyMs: 90000 },
    { passed: false, responseLatencyMs: 10 },
    { passed: true, responseLatencyMs: null },
  ];
  const result = summarizeCampaign(samples, 4);
  expect(result.correctness).toEqual({
    planned: 4,
    attempted: 3,
    passed: 2,
    failed: 1,
    unattempted: 1,
  });
  expect(result.latency).toEqual({
    measured: 2,
    missing: 1,
    p50: 10,
    p95: 90000,
  });
  expect(
    summarizeCampaign(
      samples.map((s) => ({ ...s, responseLatencyMs: 1 })),
      4,
    ).correctness,
  ).toEqual(result.correctness);
});

test('input-to-display timing excludes setup and rejects missing or reversed milestones', () => {
  expect(
    inputToDisplayLatency([
      { stage: 'last-input-signal', duration: 3000 },
      { stage: 'display-commit', duration: 8000 },
    ]),
  ).toBe(5000);
  expect(inputToDisplayLatency([])).toBeNull();
  expect(
    inputToDisplayLatency([
      { stage: 'last-input-signal', duration: 3000 },
      { stage: 'display-commit', duration: 2000 },
    ]),
  ).toBeNull();
});

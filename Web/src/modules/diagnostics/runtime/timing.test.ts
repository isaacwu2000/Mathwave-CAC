import { afterEach, expect, test, vi } from 'vitest';
import {
  RequestTiming,
  journeyPoint,
  journeySpan,
  journeyServerTiming,
} from './timing.ts';

afterEach(() => {
  vi.restoreAllMocks();
  performance.clearMeasures();
});

test('server timings include completed and failed stages using durations, not clock timestamps', async () => {
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const timing = new RequestTiming();
  await timing.measure('load', async () => {
    now += 25;
  });
  await expect(
    timing.measure('model_1', async () => {
      now += 80;
      throw new Error('private provider detail');
    }),
  ).rejects.toThrow('private provider detail');
  expect(timing.header()).toBe(
    'load;dur=25.0, model_1;dur=80.0, total;dur=105.0',
  );
});

test('browser stages correlate by request without storing request content', () => {
  journeyPoint('timing-test', 'submitted', 100);
  journeySpan('timing-test', 'network', 110, 160);
  journeyPoint('timing-test', 'confirmed', 180);
  const entries = performance
    .getEntriesByType('measure')
    .filter((e) =>
      e.name.startsWith('math-audio:journey:'),
    ) as PerformanceMeasure[];
  expect(entries.map((e) => [e.detail.stage, e.duration, e.detail])).toEqual(
    expect.arrayContaining([
      [
        'submitted',
        0,
        { id: 'timing-test', kind: 'milestone', stage: 'submitted' },
      ],
      ['network', 50, { id: 'timing-test', kind: 'span', stage: 'network' }],
      [
        'confirmed',
        80,
        { id: 'timing-test', kind: 'milestone', stage: 'confirmed' },
      ],
    ]),
  );
});

test('bounded retention preserves recent stages when old entries expire', () => {
  for (let i = 0; i < 310; i++) journeySpan('retention', 'repeated', i, i + 1);
  const entries = performance
    .getEntriesByType('measure')
    .filter((e) => e.name.startsWith('math-audio:journey:'));
  expect(entries.length).toBeLessThanOrEqual(300);
  expect(entries.at(-1)?.startTime).toBe(309);
});

test('connection and command server timings remain separate for the same request', () => {
  journeyServerTiming('one-request', 'total;dur=500.0', 'live-server');
  journeyServerTiming('one-request', 'total;dur=3000.0');
  const entries = performance.getEntriesByType(
    'measure',
  ) as PerformanceMeasure[];
  expect(
    entries
      .filter((e) => e.detail.id === 'one-request')
      .map((e) => [e.detail.stage, e.duration]),
  ).toEqual([
    ['live-server:total', 500],
    ['problem-server:total', 3000],
  ]);
});

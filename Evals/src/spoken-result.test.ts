import { afterEach, expect, test, vi } from 'vitest';
import { spokenResultFinished, waitForSpokenResult } from './spoken-result.ts';
import type { Page } from 'playwright';

afterEach(() => vi.unstubAllGlobals());

test('an acknowledgement before saving cannot complete a spoken result', () => {
  const evidence = {
    voiceObservations: [
      {
        at: 10,
        audible: true,
        speaking: true,
        expected: 'Okay',
        settled: true,
      },
      {
        at: 30,
        audible: false,
        speaking: false,
        expected: 'Okay',
        settled: true,
      },
    ],
    liveEvaluationEvents: [
      { at: 5, type: 'session.output_transcript.delta', delta: 'Okay' },
    ],
  };
  vi.stubGlobal('window', evidence);
  expect(spokenResultFinished(20)).toBe(false);
  evidence.voiceObservations.push(
    {
      at: 40,
      audible: true,
      speaking: true,
      expected: 'Median six',
      settled: true,
    },
    {
      at: 60,
      audible: false,
      speaking: false,
      expected: 'Median six',
      settled: true,
    },
  );
  expect(spokenResultFinished(20)).toBe(false);
  evidence.liveEvaluationEvents.push({
    at: 35,
    type: 'session.output_transcript.delta',
    delta: 'Median six',
  });
  expect(spokenResultFinished(20)).toBe(false);
  evidence.voiceObservations.push({
    at: 1100,
    audible: false,
    speaking: false,
    expected: 'Median six',
    settled: true,
  });
  expect(spokenResultFinished(20)).toBe(true);
});

test('a brief pause between spoken phrases does not finish the result', () => {
  const samples = [
    {
      at: 100,
      audible: true,
      speaking: true,
      expected: 'Your equation',
      settled: true,
    },
    {
      at: 500,
      audible: false,
      speaking: false,
      expected: 'Your equation',
      settled: true,
    },
  ];
  vi.stubGlobal('window', {
    voiceObservations: samples,
    liveEvaluationEvents: [
      {
        at: 90,
        type: 'session.output_transcript.delta',
        delta: 'Your equation',
      },
    ],
  });
  expect(spokenResultFinished(50)).toBe(false);
  samples.push({
    at: 600,
    audible: true,
    speaking: true,
    expected: 'Your equation is written.',
    settled: true,
  });
  samples.push({
    at: 1500,
    audible: false,
    speaking: false,
    expected: 'Your equation is written.',
    settled: true,
  });
  expect(spokenResultFinished(50)).toBe(false);
  samples.push({
    at: 1700,
    audible: false,
    speaking: false,
    expected: 'Your equation is written.',
    settled: true,
  });
  expect(spokenResultFinished(50)).toBe(true);
});

test('the voice journey waits when display commits before the completed result is sent', async () => {
  let commentaryReady = false;
  const page = {
    evaluate: async () => (commentaryReady ? 100 : null),
    waitForFunction: async () => {
      commentaryReady = true;
    },
  } as unknown as Page;
  await expect(waitForSpokenResult(page, [])).resolves.toBeUndefined();
});

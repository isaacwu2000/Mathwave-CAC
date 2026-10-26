import { expect, test } from 'vitest';
import { assessVoiceParity, type VoiceObservation } from './voice-parity.ts';
const sample = (
  at: number,
  audible: boolean,
  speaking: boolean,
  text = 'x equals four',
): VoiceObservation => ({
  at,
  audible,
  speaking,
  text,
  expected: 'x equals four',
  source: 'pico',
  settled: true,
});

test('caption parity allows sentence separators but rejects changed words and split tokens', () => {
  const frames = [sample(0, true, true), sample(1000, false, false)].map(
    (s) => ({
      ...s,
      expected: 'OK.Made the triangle!',
      text: 'OK. Made the triangle!',
    }),
  );
  expect(assessVoiceParity(frames).passed).toBe(true);
  expect(
    assessVoiceParity(
      frames.map((s) => ({ ...s, text: 'OK. Made the tri angle!' })),
    ).passed,
  ).toBe(false);
  expect(
    assessVoiceParity(
      frames.map((s) => ({ ...s, text: 'OK. Made the rectangle!' })),
    ).passed,
  ).toBe(false);
});
test('parity requires matching spoken text, actual sound, and a settled idle indicator', () => {
  expect(
    assessVoiceParity([sample(0, true, true), sample(1000, false, false)])
      .passed,
  ).toBe(true);
  expect(assessVoiceParity([]).passed).toBe(false);
  expect(
    assessVoiceParity([
      sample(0, true, true, 'Pico is speaking…'),
      sample(1000, false, false),
    ]).passed,
  ).toBe(false);
  expect(
    assessVoiceParity([sample(0, true, true), sample(1000, false, true)])
      .passed,
  ).toBe(false);
  expect(
    assessVoiceParity([sample(0, true, false), sample(1000, false, false)])
      .passed,
  ).toBe(false);
});

test('student text masking audible Pico output fails parity', () => {
  expect(
    assessVoiceParity([
      { ...sample(0, true, true), source: 'student', text: 'write x' },
      sample(1000, false, false),
    ]).passed,
  ).toBe(false);
});

test('a brief indicator flicker is allowed, but continuous disagreement fails', () => {
  const stable = Array.from({ length: 15 }, (_, i) =>
    sample(i * 100, true, true),
  );
  const flicker = stable.map((s, i) =>
    i === 7 ? { ...s, speaking: false } : s,
  );
  expect(
    assessVoiceParity([...flicker, sample(1600, false, false)]).passed,
  ).toBe(true);
  const sustained = stable.map((s, i) =>
    i >= 3 && i <= 10 ? { ...s, speaking: false } : s,
  );
  expect(
    assessVoiceParity([...sustained, sample(1600, false, false)]).passed,
  ).toBe(false);
});

test('stopped recording cannot leave student text in the microphone', () => {
  const completed = [
    sample(0, true, true),
    {
      ...sample(1000, false, false),
      microphoneActive: false,
      microphoneText: 'close help',
    },
  ];
  expect(assessVoiceParity(completed).passed).toBe(false);
  completed[1].microphoneText = '';
  expect(assessVoiceParity(completed).passed).toBe(true);
});

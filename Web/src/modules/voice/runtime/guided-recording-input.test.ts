import { afterEach, expect, test, vi } from 'vitest';
import { recognizeGuidedLine } from './guided-recording-input.ts';
import type { VoiceEnvironment } from './browser-live.ts';
import type { AudioFrame } from '../types/index.ts';
afterEach(() => vi.useRealTimers());
async function harness() {
  vi.useFakeTimers({
    toFake: [
      'performance',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  let sample!: (frame: AudioFrame) => void,
    receive!: (event: Record<string, unknown>) => void;
  const close = vi.fn(),
    dispose = vi.fn(),
    send = vi.fn(),
    partial = vi.fn();
  const connect = vi.fn<VoiceEnvironment['connect']>(
    async (_capture, _context, callback) => {
      receive = callback;
      return { send, dispose, speaking: () => false, mute: vi.fn() };
    },
  );
  const environment: VoiceEnvironment = {
    configured: async () => true,
    monitor: async (callback) => {
      sample = callback;
      return {
        stream: {} as MediaStream,
        play() {},
        draining: () => false,
        close,
      };
    },
    connect,
  };
  const controller = new AbortController();
  const done = vi.fn();
  const result = recognizeGuidedLine(
    { revision: '1', workspace: {} },
    { partial, status() {} },
    controller.signal,
    environment,
  ).then((value) => {
    done(value);
    return value;
  });
  await vi.advanceTimersByTimeAsync(1);
  const sound = async (level: number, ms: number) => {
    for (let t = 0; t < ms; t += 20) {
      sample({
        at: performance.now(),
        sampleRate: 48000,
        samples: new Float32Array(960).fill(level),
      });
      await vi.advanceTimersByTimeAsync(20);
    }
  };
  return {
    connect,
    environment,
    controller,
    result,
    done,
    close,
    dispose,
    send,
    partial,
    sound,
    event: (event: Record<string, unknown>) => receive(event),
  };
}
test('waits for real speech, displays actual deltas, and does not finish through a speaking pause', async () => {
  const h = await harness();
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.connect).not.toHaveBeenCalled();
  expect(h.done).not.toHaveBeenCalled();
  await h.sound(0.01, 100);
  h.event({ type: 'session.started' });
  h.event({ type: 'session.input_transcript.delta', delta: 'Zoom' });
  await h.sound(0, 1000);
  expect(h.done).not.toHaveBeenCalled();
  await h.sound(0.01, 200);
  h.event({ type: 'session.input_transcript.delta', delta: ' in please' });
  h.event({
    type: 'session.delegation.created',
    delegation: { id: 'input-only', target: 'client' },
  });
  await h.sound(0, 1700);
  expect(h.done).not.toHaveBeenCalled();
  await h.sound(0, 200);
  expect(await h.result).toBe('Zoom in please');
  expect(h.partial).toHaveBeenLastCalledWith('Zoom in please');
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.send).toHaveBeenCalledWith({ type: 'session.close' });
  await vi.advanceTimersByTimeAsync(1600);
  expect(h.dispose).toHaveBeenCalledOnce();
});
test('cancellation releases the microphone and ignores late transcript events', async () => {
  const h = await harness();
  await h.sound(0.01, 100);
  h.event({ type: 'session.started' });
  const rejected = expect(h.result).rejects.toMatchObject({
    name: 'AbortError',
  });
  h.controller.abort();
  await rejected;
  const before = h.partial.mock.calls.length;
  h.event({ type: 'session.input_transcript.delta', delta: 'late text' });
  expect(h.partial).toHaveBeenCalledTimes(before);
  expect(h.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1600);
  expect(vi.getTimerCount()).toBe(0);
});

test('stopping during permission startup releases a microphone granted afterward', async () => {
  vi.useFakeTimers();
  let grant!: (value: Awaited<ReturnType<VoiceEnvironment['monitor']>>) => void;
  const close = vi.fn(),
    connect = vi.fn();
  const environment: VoiceEnvironment = {
    configured: async () => true,
    monitor: () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
    connect,
  };
  const controller = new AbortController();
  const result = recognizeGuidedLine(
    { revision: '1', workspace: {} },
    { partial() {}, status() {} },
    controller.signal,
    environment,
  );
  await vi.advanceTimersByTimeAsync(0);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  grant({ stream: {} as MediaStream, play() {}, draining: () => false, close });
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledOnce();
  expect(connect).not.toHaveBeenCalled();
});

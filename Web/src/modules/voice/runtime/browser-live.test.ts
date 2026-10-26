import { afterEach, expect, test, vi } from 'vitest';
import { browserVoiceEnvironment } from './browser-live.ts';

afterEach(() => vi.unstubAllGlobals());

test('cancelling capture closes the microphone even when audio initialization never settles', async () => {
  const stop = vi.fn();
  const close = vi.fn(async () => {});
  const resume = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop }] }),
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = resume;
      close = close;
    },
  );
  const controller = new AbortController();
  const pending = browserVoiceEnvironment.monitor(() => {}, controller.signal);
  await Promise.resolve();
  expect(resume).toHaveBeenCalledOnce();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

test('a microphone granted after cancellation is closed without reopening audio', async () => {
  const stop = vi.fn();
  const opened = vi.fn();
  let grant!: (stream: { getTracks(): { stop(): void }[] }) => void;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        opened();
      }
      resume = async () => {};
      close = async () => {};
    },
  );
  const controller = new AbortController();
  const pending = browserVoiceEnvironment.monitor(() => {}, controller.signal);
  controller.abort();
  grant({ getTracks: () => [{ stop }] });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(stop).toHaveBeenCalledOnce();
  expect(opened).toHaveBeenCalledOnce();
});

test('audio is resumed in the Record click before waiting for microphone permission', async () => {
  const resume = vi.fn(() => new Promise<void>(() => {}));
  const close = vi.fn(async () => {});
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: () => new Promise(() => {}) },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = resume;
      close = close;
    },
  );
  const controller = new AbortController();
  const pending = browserVoiceEnvironment.monitor(() => {}, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(resume).toHaveBeenCalledOnce();
  controller.abort();
  await rejected;
  expect(close).toHaveBeenCalledOnce();
});

test.each([
  ['NotAllowedError', /school.*IT/i],
  ['NotFoundError', /No microphone/],
  ['NotReadableError', /busy/],
])(
  'capture explains %s and releases its audio engine',
  async (name, message) => {
    const close = vi.fn(async () => {});
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException('device failure', name);
        },
      },
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = async () => {};
        close = close;
      },
    );
    await expect(browserVoiceEnvironment.monitor(() => {})).rejects.toThrow(
      message,
    );
    expect(close).toHaveBeenCalledOnce();
  },
);

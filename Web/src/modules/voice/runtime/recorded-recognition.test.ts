import { test } from 'vitest';
import assert from 'node:assert/strict';
import { recognizeRecording } from '../index.ts';
import type { Recognition } from '../index.ts';

test('recording recognition owns its audio track and cleans up success and cancellation', async () => {
  const saved = new Map(
    ['window', 'navigator', 'AudioContext', 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  let stopped = 0,
    closed = 0,
    played = 0,
    aborted = 0;
  const track = {
    kind: 'audio',
    stop: () => {
      stopped++;
    },
  };
  const instances: FakeRecognition[] = [];
  let ready!: () => void;
  let completed: Promise<void>;
  class FakeRecognition implements Recognition {
    lang = '';
    continuous = false;
    interimResults = false;
    onstart: Recognition['onstart'] = null;
    onend: Recognition['onend'] = null;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    constructor() {
      instances.push(this);
    }
    start(input?: unknown) {
      assert.equal(input, track);
      this.onstart?.();
      ready();
    }
    stop() {
      this.onend?.();
    }
    abort() {
      aborted++;
    }
  }
  class FakeAudio {
    currentTime = 0;
    resume() {
      return Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve({ duration: 1 });
    }
    createMediaStreamDestination() {
      return {
        stream: { getAudioTracks: () => [track], getTracks: () => [track] },
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start(time: number) {
          assert.equal(time, 0.3);
          played++;
        },
        stop() {},
      };
    }
    close() {
      closed++;
      return Promise.resolve();
    }
  }
  for (const [key, value] of Object.entries({
    window: { SpeechRecognition: FakeRecognition },
    navigator: {
      userAgent: 'Chrome/150.0',
      get mediaDevices() {
        throw new Error('A recording test must not open the microphone.');
      },
    },
    AudioContext: FakeAudio,
    fetch: async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }),
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  try {
    completed = new Promise((resolve) => {
      ready = resolve;
    });
    const controller = new AbortController();
    const result = recognizeRecording(
      '/fixture.wav',
      controller.signal,
      () => {},
    );
    await completed;
    const event = {
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'write x equals three' } }],
    };
    instances.at(-1)!.onresult!(event);
    instances.at(-1)!.onresult!(event);
    instances.at(-1)!.onend!();
    assert.equal(await result, 'write x equals three');
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    assert.equal(aborted, 1);
    completed = new Promise((resolve) => {
      ready = resolve;
    });
    const second = new AbortController();
    const pending = recognizeRecording('/fixture.wav', second.signal, () => {});
    await completed;
    const lateStart = instances.at(-1)!.onstart!;
    second.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    lateStart();
    assert.equal(played, 2);
    assert.equal(stopped, 2);
    assert.equal(closed, 2);
    assert.equal(instances.at(-1)!.onresult, null);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

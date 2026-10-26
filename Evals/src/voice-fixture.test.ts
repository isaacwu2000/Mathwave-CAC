import { afterEach, expect, test, vi } from 'vitest';
import { installVoiceFixture, type FixtureWindow } from './voice-fixture.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('overlapping output does not mistake a late input fragment for a new student turn', async () => {
  vi.useFakeTimers();
  const channel = new EventTarget() as EventTarget & {
    send(data: string): void;
  };
  channel.send = vi.fn();
  class Peer {
    createDataChannel() {
      return channel;
    }
    addEventListener() {}
  }
  const page = { Audio: class {} } as unknown as FixtureWindow;
  vi.stubGlobal('window', page);
  vi.stubGlobal('navigator', { mediaDevices: {} });
  vi.stubGlobal('AudioContext', class {});
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('document', {
    querySelector: () => ({
      getAttribute: () => 'false',
      querySelector: (selector: string) =>
        selector === '.audio-panel'
          ? {
              getAttribute: () => 'false',
              querySelector: () => ({ textContent: '' }),
            }
          : { getAttribute: () => 'pico', textContent: '' },
    }),
  });
  installVoiceFixture('/synthetic.wav');
  new Peer().createDataChannel();
  const receive = (type: string, delta: string) =>
    channel.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ type, delta }) }),
    );
  receive('session.input_transcript.delta', 'graph x');
  receive('session.output_transcript.delta', 'Okay, ');
  receive('session.input_transcript.delta', ' squared');
  receive('session.output_transcript.delta', 'graphing.');
  await vi.advanceTimersByTimeAsync(100);
  expect(page.voiceObservations?.at(-1)?.expected).toBe('Okay, graphing.');
  channel.send(JSON.stringify({ type: 'session.commentary.append' }));
  receive('session.input_transcript.delta', 'add one');
  receive('session.output_transcript.delta', 'Added one.');
  await vi.advanceTimersByTimeAsync(100);
  expect(page.voiceObservations?.at(-1)?.expected).toBe('Added one.');
  receive('session.closed', '');
  receive('session.input_transcript.delta', 'write x equals four');
  receive('session.output_transcript.delta', 'Recovered.');
  await vi.advanceTimersByTimeAsync(100);
  expect(page.voiceObservations?.at(-1)?.expected).toBe('Recovered.');
});

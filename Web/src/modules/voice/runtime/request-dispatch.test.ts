import { afterEach, expect, test, vi } from 'vitest';
import { OpenAIVoiceSession } from './openai-voice-session.ts';
import { directMathCommand } from '../../commands/index.ts';
import { blankWorkspace } from '../../problems/index.ts';
import type { AudioFrame } from '../types/index.ts';

afterEach(() => vi.useRealTimers());
async function harness() {
  vi.useFakeTimers({
    toFake: [
      'performance',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
  let sample!: (frame: AudioFrame) => void;
  let lastForward = -Infinity;
  const connections: {
    event: (event: Record<string, unknown>) => void;
    send: ReturnType<typeof vi.fn>;
  }[] = [];
  const execute = vi.fn(
    async (_text: string, _id: string, _signal?: AbortSignal) => ({
      saved: true,
    }),
  );
  const session = new OpenAIVoiceSession(
    {
      state() {},
      partial() {},
      error() {},
      notice() {},
      context: () => ({ revision: '1', workspace: {} }),
      execute,
      complete: (text) =>
        !!directMathCommand(text, {
          ...blankWorkspace(),
          expression: '2*x+3=11',
        }),
    },
    {
      configured: async () => true,
      monitor: async (callback) => {
        sample = callback;
        return {
          stream: {} as MediaStream,
          play: (frame) => {
            lastForward = frame.at;
          },
          draining: () => lastForward > performance.now() - 40,
          close() {},
        };
      },
      connect: async (_capture, _context, event) => {
        const c = {
          event,
          send: vi.fn(),
          dispose() {},
          speaking: () => false,
          mute() {},
        };
        connections.push(c);
        return c;
      },
    },
  );
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
  session.toggle();
  await vi.advanceTimersByTimeAsync(1);
  await sound(0.01, 100);
  connections[0].event({ type: 'session.started' });
  return {
    session,
    execute,
    connections,
    sound,
    transcript: (delta: string) =>
      connections
        .at(-1)!
        .event({ type: 'session.input_transcript.delta', delta }),
  };
}

test('a complete reconnected request drains and executes before the five-second idle deadline', async () => {
  const h = await harness();
  await h.sound(0, 5200);
  h.connections[0].event({ type: 'session.closed' });
  await h.sound(0.01, 100);
  h.connections[1].event({ type: 'session.started' });
  h.transcript('Write two x plus three equals eleven.');
  await h.sound(0, 1600);
  expect(h.execute).toHaveBeenCalledOnce();
  h.connections[1].event({
    type: 'session.delegation.created',
    delegation: { id: 'late', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.execute).toHaveBeenCalledOnce();
  expect(
    h.connections[1].send.mock.calls.some(([e]) => e.type === 'session.close'),
  ).toBe(false);
  h.session.stop();
});

test('partial or ambiguous speech keeps the longer pause allowance', async () => {
  const h = await harness();
  h.transcript('write x equals');
  await h.sound(0, 1600);
  expect(h.execute).not.toHaveBeenCalled();
  h.transcript(' four');
  await h.sound(0, 600);
  expect(h.execute).toHaveBeenCalledWith(
    'write x equals four',
    expect.any(String),
    expect.any(AbortSignal),
  );
  h.session.stop();
});

test('continued student speech invalidates an older complete transcript until fresh text arrives', async () => {
  const h = await harness();
  h.transcript('write x equals four');
  await h.sound(0.01, 2200);
  await h.sound(0, 1500);
  expect(h.execute).not.toHaveBeenCalled();
  h.transcript(' plus one');
  await h.sound(0, 600);
  expect(h.execute).toHaveBeenCalledWith(
    'write x equals four plus one',
    expect.any(String),
    expect.any(AbortSignal),
  );
  h.session.stop();
});

test('a late delegation after a saved fallback does not speak an unsupported error', async () => {
  const h = await harness();
  h.transcript('write x equals four');
  await h.sound(0, 1600);
  expect(h.execute).toHaveBeenCalledOnce();
  const before = h.connections[0].send.mock.calls.filter(
    ([e]) => e.type === 'session.commentary.append',
  ).length;
  h.connections[0].event({
    type: 'session.delegation.created',
    delegation: { id: 'late-after-save', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.execute).toHaveBeenCalledOnce();
  expect(
    h.connections[0].send.mock.calls.filter(
      ([e]) => e.type === 'session.commentary.append',
    ),
  ).toHaveLength(before);
  h.session.stop();
});

test('delegation arriving before its transcript waits for settled text and preserves the original request', async () => {
  const h = await harness();
  h.connections[0].event({
    type: 'session.delegation.created',
    delegation: { id: 'before-text', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(h.execute).not.toHaveBeenCalled();
  expect(
    h.connections[0].send.mock.calls.filter(
      ([e]) => e.type === 'session.commentary.append',
    ),
  ).toHaveLength(0);
  h.transcript('Could you explain why the equality stays true?');
  await h.sound(0, 1600);
  expect(h.execute).toHaveBeenCalledWith(
    'Could you explain why the equality stays true?',
    expect.any(String),
    expect.any(AbortSignal),
  );
  const replies = h.connections[0].send.mock.calls.filter(
    ([e]) => e.type === 'session.commentary.append',
  );
  expect(replies.at(-1)?.[0].delegation_id).toBe('before-text');
  h.session.stop();
});

test('early delegation keeps waiting while the student is still speaking', async () => {
  const h = await harness();
  h.connections[0].event({
    type: 'session.delegation.created',
    delegation: { id: 'long-request', target: 'client' },
  });
  await h.sound(0.01, 6200);
  expect(h.execute).not.toHaveBeenCalled();
  h.transcript('Explain how the two graphs differ near their intersection.');
  await h.sound(0, 1600);
  expect(h.execute).toHaveBeenCalledOnce();
  const replies = h.connections[0].send.mock.calls.filter(
    ([e]) => e.type === 'session.commentary.append',
  );
  expect(replies.at(-1)?.[0].delegation_id).toBe('long-request');
  h.session.stop();
});

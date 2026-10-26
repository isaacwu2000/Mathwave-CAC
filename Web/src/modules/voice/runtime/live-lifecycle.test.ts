import { afterEach, expect, test, vi } from 'vitest';
import { OpenAIVoiceSession } from './openai-voice-session.ts';
import type { VoiceEnvironment } from './browser-live.ts';
import type { AudioFrame } from '../services/silence-monitor.ts';

afterEach(() => vi.useRealTimers());
function harness(
  execute = async (
    _text: string,
    _id: string,
    _signal?: AbortSignal,
  ): Promise<unknown> => ({
    saved: true,
  }),
) {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
    ],
  });
  let sample!: (frame: AudioFrame) => void;
  const connections: Array<{
    send: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    speaking: ReturnType<typeof vi.fn<() => boolean>>;
    event: (event: Record<string, unknown>) => void;
  }> = [];
  const released = vi.fn();
  const draining = vi.fn(() => false);
  const played: AudioFrame[] = [];
  const states: string[] = [];
  const notices: string[] = [];
  const levels: number[] = [];
  const playback: boolean[] = [];
  const replies: string[] = [];
  const partials: string[] = [];
  const environment: VoiceEnvironment = {
    configured: async () => true,
    monitor: async (callback) => {
      sample = callback;
      return {
        stream: {} as MediaStream,
        play: (frame) => played.push(frame),
        draining,
        close: released,
      };
    },
    connect: async (_capture, _context, event) => {
      const connection = {
        send: vi.fn(),
        dispose: vi.fn(),
        speaking: vi.fn(() => false),
        event,
      };
      connections.push(connection);
      return { ...connection, mute() {} };
    },
  };
  const session = new OpenAIVoiceSession(
    {
      state: (state) => states.push(state),
      partial: (value) => partials.push(value),
      playback: (value) => playback.push(value),
      reply: (value) => replies.push(value),
      level: (value) => levels.push(value),
      error: (text) => notices.push(text),
      notice: (text) => notices.push(text),
      context: () => ({ revision: '1', workspace: {} }),
      execute,
    },
    environment,
  );
  return {
    session,
    environment,
    connections,
    played,
    states,
    notices,
    levels,
    playback,
    replies,
    partials,
    released,
    draining,
    async start() {
      session.toggle();
      await vi.advanceTimersByTimeAsync(1);
    },
    async sound(level = 0.01, milliseconds = 100) {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) {
        sample({
          samples: new Float32Array(960).fill(level),
          sampleRate: 48000,
          at: performance.now(),
        });
        await vi.advanceTimersByTimeAsync(20);
      }
    },
  };
}
test('a stalled microphone startup times out and closes a capture that arrives late', async () => {
  const h = harness();
  const monitor = h.environment.monitor.bind(h.environment);
  let release!: (capture: Awaited<ReturnType<typeof monitor>>) => void;
  let signal: AbortSignal | undefined;
  h.environment.monitor = (_sample, pendingSignal) => {
    signal = pendingSignal;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  await h.start();
  expect(h.states.at(-1)).toBe('starting');
  await vi.advanceTimersByTimeAsync(16000);
  expect(h.states.at(-1)).toBe('idle');
  expect(h.notices.at(-1)).toMatch(/startup timed out/i);
  expect(signal?.aborted).toBe(true);
  const close = vi.fn();
  release({
    stream: {} as MediaStream,
    play() {},
    draining: () => false,
    close,
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(close).toHaveBeenCalledOnce();
  expect(h.states.at(-1)).toBe('idle');
  h.environment.monitor = monitor;
  await h.start();
  expect(h.states.at(-1)).toBe('listening');
  h.session.stop();
});
test.each(['delegation', 'silence'])(
  'student captions stream before %s and remain visible while the command runs',
  async (dispatch) => {
    const execute = vi.fn(async () => ({ saved: true }));
    const h = harness(execute);
    await h.start();
    await h.sound();
    const c = h.connections[0];
    c.event({ type: 'session.started' });
    c.event({ type: 'session.input_transcript.delta', delta: 'write x' });
    expect(h.partials.at(-1)).toBe('write x');
    expect(execute).not.toHaveBeenCalled();
    c.event({ type: 'session.input_transcript.delta', delta: ' equals four' });
    expect(h.partials.at(-1)).toBe('write x equals four');
    if (dispatch === 'delegation')
      c.event({
        type: 'session.delegation.created',
        delegation: { id: 'caption-request', target: 'client' },
      });
    else await h.sound(0, 5200);
    expect(execute).toHaveBeenCalledOnce();
    expect(h.partials.at(-1)).toBe('write x equals four');
    c.event({ type: 'session.input_transcript.delta', delta: 'subtract one' });
    expect(h.partials.at(-1)).toBe('subtract one');
    h.session.stop();
    expect(h.partials.at(-1)).toBe('');
    c.event({ type: 'session.input_transcript.delta', delta: ' stale' });
    expect(h.partials.at(-1)).toBe('');
  },
);
test('local listening creates no session in silence, then replays speech in order and closes after five seconds', async () => {
  const h = harness();
  await h.start();
  await h.sound(0, 10000);
  expect(h.connections).toHaveLength(0);
  expect(h.states.at(-1)).toBe('listening');
  await h.sound(0.004, 100);
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  expect(h.played.length).toBeGreaterThan(5);
  expect(h.played.map((frame) => frame.at)).toEqual(
    h.played.map((frame) => frame.at).toSorted((a, b) => a - b),
  );
  await h.sound(0, 4900);
  expect(
    connection.send.mock.calls.some(
      ([event]) => event.type === 'session.close',
    ),
  ).toBe(false);
  await h.sound(0, 150);
  expect(
    connection.send.mock.calls.some(
      ([event]) => event.type === 'session.close',
    ),
  ).toBe(true);
  expect(connection.dispose).not.toHaveBeenCalled();
  connection.event({
    type: 'session.closed',
    reason: 'close_requested',
    usage: { seconds: 5 },
  });
  expect(connection.dispose).toHaveBeenCalledOnce();
  expect(h.released).not.toHaveBeenCalled();
  expect(h.states.at(-1)).toBe('listening');
  await h.sound(0.004);
  expect(h.connections).toHaveLength(2);
  h.session.stop();
});

test('stopping listening aborts delegated preview generation', async () => {
  let signal: AbortSignal | undefined;
  const h = harness(async (_text, _id, currentSignal) => {
    signal = currentSignal;
    return new Promise(() => {});
  });
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.input_transcript.delta', delta: 'graph x squared' });
  c.event({
    type: 'session.delegation.created',
    delegation: { id: 'build', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  h.session.stop();
  expect(signal?.aborted).toBe(true);
});
test('student silence does not close Live during speech or pauses within its reply', async () => {
  const h = harness();
  await h.start();
  await h.sound();
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  connection.speaking.mockReturnValue(true);
  await h.sound(0, 7000);
  expect(connection.send).not.toHaveBeenCalled();

  // Playback detection falls inactive during natural pauses in a reply.
  connection.speaking.mockReturnValue(false);
  await h.sound(0, 1000);
  expect(connection.send).not.toHaveBeenCalled();
  connection.speaking.mockReturnValue(true);
  await h.sound(0, 2000);
  expect(connection.send).not.toHaveBeenCalled();

  connection.speaking.mockReturnValue(false);
  await h.sound(0, 4900);
  expect(connection.send).not.toHaveBeenCalled();
  await h.sound(0, 150);
  expect(connection.send).toHaveBeenCalledWith({
    type: 'session.close',
    event_id: expect.any(String),
  });
  connection.event({ type: 'session.closed' });
  h.session.stop();
});
test('silence keeps an outstanding command and its acknowledgement alive and ignores duplicate delegations', async () => {
  let finish!: (value: unknown) => void;
  const execute = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const h = harness(execute);
  await h.start();
  await h.sound();
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  connection.event({
    type: 'session.input_transcript.delta',
    delta: 'subtract three from both sides',
  });
  const event = {
    type: 'session.delegation.created',
    delegation: { id: 'task-1', target: 'client' },
  };
  connection.event(event);
  connection.event(event);
  await h.sound(0, 6000);
  expect(execute).toHaveBeenCalledOnce();
  expect(
    connection.send.mock.calls.some(
      ([value]) => value.type === 'session.close',
    ),
  ).toBe(false);
  finish({ saved: true });
  await vi.advanceTimersByTimeAsync(1);
  const result = connection.send.mock.calls.find(
    ([value]) => value.type === 'session.commentary.append',
  )![0];
  connection.event({
    type: 'session.commentary.appended',
    client_event_id: result.event_id,
  });
  await vi.advanceTimersByTimeAsync(25);
  expect(
    connection.send.mock.calls.some(
      ([value]) => value.type === 'session.close',
    ),
  ).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(
    connection.send.mock.calls.some(
      ([value]) => value.type === 'session.close',
    ),
  ).toBe(true);
  connection.event({ type: 'session.closed' });
  h.session.stop();
});
test('stopping clears recognized text and later provider events cannot execute stale work', async () => {
  const execute = vi.fn(async (_text: string, _id: string) => ({
    saved: true,
  }));
  const h = harness(execute);
  await h.start();
  await h.sound();
  const old = h.connections[0];
  old.event({ type: 'session.started' });
  old.event({
    type: 'session.input_transcript.delta',
    delta: 'subtract three',
  });
  h.session.stop();
  old.event({ type: 'session.closed' });
  expect(h.released).toHaveBeenCalledOnce();
  await h.start();
  await h.sound();
  const next = h.connections[1];
  next.event({ type: 'session.started' });
  next.event({ type: 'session.input_transcript.delta', delta: 'add five' });
  next.event({
    type: 'session.delegation.created',
    delegation: { id: 'new-task', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(execute.mock.calls[0][0]).toBe('add five');
  old.event({
    type: 'session.delegation.created',
    delegation: { id: 'old-task', target: 'client' },
  });
  expect(execute).toHaveBeenCalledOnce();
  h.session.stop();
});
test('failed sessions reject late transcripts and missing closure acknowledgement is visible', async () => {
  const execute = vi.fn(async (_text: string, _id: string) => ({
    saved: true,
  }));
  const h = harness(execute);
  await h.start();
  await h.sound();
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  connection.event({ type: 'transport.error' });
  connection.event({
    type: 'session.input_transcript.delta',
    delta: 'add five',
  });
  connection.event({
    type: 'session.delegation.created',
    delegation: { id: 'stale', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(3500);
  expect(execute).not.toHaveBeenCalled();
  expect(
    h.notices.some((text) => text.includes('did not confirm session closure')),
  ).toBe(true);
  expect(h.states.at(-1)).toBe('listening');
  h.session.stop();
});
test('startup buffering is bounded and stopping prevents a late connection from reconnecting', async () => {
  const h = harness();
  await h.start();
  await h.sound();
  // No session.started event: all opening speech remains buffered.
  await h.sound(0.01, 12100);
  expect(h.notices.some((text) => text.includes('buffering exceeded'))).toBe(
    true,
  );
  h.session.stop();
  expect(h.released).toHaveBeenCalledOnce();
  h.connections[0].event({ type: 'session.started' });
  h.connections[0].event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(h.connections).toHaveLength(1);
  expect(h.states.at(-1)).toBe('idle');
});
test('an explicit readback while monitoring also closes its session after the idle deadline', async () => {
  const h = harness();
  await h.start();
  h.session.reportFacts({ readback: 'x equals four' });
  await vi.advanceTimersByTimeAsync(1);
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  const result = connection.send.mock.calls.find(
    ([value]) => value.type === 'session.commentary.append',
  )![0];
  expect(JSON.parse(result.content).result).toBe('x equals four');
  connection.event({
    type: 'session.commentary.appended',
    client_event_id: result.event_id,
  });
  await vi.advanceTimersByTimeAsync(5025);
  expect(
    connection.send.mock.calls.some(
      ([value]) => value.type === 'session.close',
    ),
  ).toBe(true);
  connection.event({ type: 'session.closed' });
  h.session.stop();
});
test('a connection that finishes after cancellation sends graceful close and waits for confirmation', async () => {
  const h = harness();
  const connect = h.environment.connect.bind(h.environment);
  let finish!: () => void;
  h.environment.connect = async (...args) => {
    const transport = await connect(...args);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return transport;
  };
  await h.start();
  await h.sound();
  h.session.stop();
  finish();
  await vi.advanceTimersByTimeAsync(1);
  const connection = h.connections[0];
  expect(
    connection.send.mock.calls.some(
      ([event]) => event.type === 'session.close',
    ),
  ).toBe(true);
  expect(connection.dispose).not.toHaveBeenCalled();
  connection.event({ type: 'session.closed', reason: 'close_requested' });
  expect(connection.dispose).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3500);
  expect(h.notices).toEqual([]);
  expect(h.connections).toHaveLength(1);
});

test('a delegated correction reaches the workspace while the previous graph is still building', async () => {
  let finish!: (value: unknown) => void;
  const execute = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const h = harness(execute);
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  for (const [id, text] of [
    ['first', 'graph x squared'],
    ['correction', 'actually x cubed'],
  ]) {
    c.event({ type: 'session.input_transcript.delta', delta: text });
    c.event({
      type: 'session.delegation.created',
      delegation: { id, target: 'client' },
    });
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(execute).toHaveBeenCalledTimes(2);
  finish({ saved: true });
  h.session.stop();
});

test('waveform reports captured level, clears on stop and ignores stale capture frames', async () => {
  const h = harness();
  await h.start();
  await h.sound(0.02, 20);
  expect(h.levels.at(-1)).toBeCloseTo(0.02);
  h.session.stop();
  expect(h.levels.at(-1)).toBe(0);
  const count = h.levels.length;
  await h.sound(0.03, 20);
  expect(h.levels).toHaveLength(count);
});

test('journey timings separate speech detection, delegated work and the next observed audio', async () => {
  const h = harness(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { status: 'command', saved: true };
  });
  const measured = vi.spyOn(performance, 'measure');
  await h.start();
  await h.sound();
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  connection.event({
    type: 'session.input_transcript.delta',
    delta: 'write x=4',
  });
  await h.sound(0, 200);
  connection.event({
    type: 'session.delegation.created',
    delegation: { id: 'timed', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(120);
  await vi.advanceTimersByTimeAsync(60);
  connection.event({ type: 'playback.activity', active: true });
  const stages = measured.mock.calls.map(([name, options]) => ({
    name,
    options: options as PerformanceMeasureOptions,
  }));
  const stage = (name: string) =>
    stages.find((s) => s.name.startsWith(`math-audio:journey:${name}:`))!
      .options;
  expect(
    (stage('delegated').end as number) -
      (stage('last-input-signal').end as number),
  ).toBe(220);
  expect(
    (stage('result-returned').end as number) -
      (stage('delegated').end as number),
  ).toBe(120);
  expect(
    (stage('next-audio-observed').end as number) -
      (stage('commentary-sent').end as number),
  ).toBe(60);
  expect(stage('delegated').detail.id).toBe(stage('result-returned').detail.id);
  expect(JSON.stringify(stages)).not.toContain('write x=4');
  h.session.stop();
});

test('a recognized request after reconnect reaches the backend despite companion speech', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  // Model a short outgoing queue that drains only after frames stop arriving.
  h.draining.mockImplementation(
    () => (h.played.at(-1)?.at ?? -Infinity) > performance.now() - 40,
  );
  await h.start();
  await h.sound();
  h.connections[0].event({ type: 'session.started' });
  await h.sound(0, 5100);
  h.connections[0].event({ type: 'session.closed' });
  await h.sound();
  const reconnected = h.connections[1];
  reconnected.event({ type: 'session.started' });
  reconnected.event({
    type: 'session.input_transcript.delta',
    delta: 'write x equals four',
  });
  reconnected.speaking.mockReturnValue(true);
  await h.sound(0, 5100);
  expect(execute).toHaveBeenCalledOnce();
  h.session.stop();
});

test('fallback waits for continuing student speech even when a transcript fragment arrived earlier', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.input_transcript.delta', delta: 'write x' });
  await h.sound(0.01, 6000);
  expect(execute).not.toHaveBeenCalled();
  c.event({ type: 'session.input_transcript.delta', delta: ' equals four' });
  await h.sound(0, 5100);
  expect(execute).toHaveBeenCalledWith(
    'write x equals four',
    expect.any(String),
    expect.any(AbortSignal),
  );
  h.session.stop();
});

test('fallback waits for a late transcript fragment to settle without extending its deadline for playback', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.input_transcript.delta', delta: 'write x' });
  await h.sound(0, 4900);
  c.event({ type: 'session.input_transcript.delta', delta: ' equals four' });
  c.speaking.mockReturnValue(true);
  await h.sound(0, 200);
  expect(execute).not.toHaveBeenCalled();
  await h.sound(0, 400);
  expect(execute).toHaveBeenCalledWith(
    'write x equals four',
    expect.any(String),
    expect.any(AbortSignal),
  );
  c.event({
    type: 'session.delegation.created',
    delegation: { id: 'late', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(execute).toHaveBeenCalledOnce();
  h.session.stop();
});

test('fallback waits for queued input audio to drain before executing settled text', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({
    type: 'session.input_transcript.delta',
    delta: 'write x equals four',
  });
  h.draining.mockReturnValue(true);
  await h.sound(0, 6000);
  expect(execute).not.toHaveBeenCalled();
  h.draining.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(25);
  expect(execute).toHaveBeenCalledOnce();
  h.session.stop();
});

test.each(['stop', 'session.closed', 'transport.error', 'mute'])(
  'speaking clears on %s and ignores late playback',
  async (ending) => {
    const h = harness();
    await h.start();
    await h.sound();
    const c = h.connections[0];
    c.event({ type: 'session.started' });
    c.event({ type: 'playback.activity', active: true });
    expect(h.playback.at(-1)).toBe(true);
    if (ending === 'stop') h.session.stop();
    else if (ending === 'mute') h.session.setReplies(false);
    else c.event({ type: ending });
    expect(h.playback.at(-1)).toBe(false);
    c.event({ type: 'playback.activity', active: true });
    expect(h.playback.at(-1)).toBe(false);
    h.session.stop();
  },
);

test('spoken transcript reaches the panel, resets for the next student turn and rejects stale output', async () => {
  const h = harness();
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.output_transcript.delta', delta: 'Let’s graph ' });
  c.event({ type: 'session.output_transcript.delta', delta: 'x squared.' });
  expect(h.replies.at(-1)).toBe('Let’s graph x squared.');
  c.event({ type: 'session.input_transcript.delta', delta: 'now add one' });
  expect(h.replies.at(-1)).toBe('');
  c.event({ type: 'session.output_transcript.delta', delta: 'Added one.' });
  expect(h.replies.at(-1)).toBe('Added one.');
  h.session.stop();
  c.event({ type: 'session.output_transcript.delta', delta: 'stale' });
  expect(h.replies.at(-1)).toBe('');
});

test('separate spoken sentences have a space without splitting streamed words or numbers', async () => {
  const h = harness();
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({
    type: 'session.output_transcript.delta',
    delta: 'OK.',
    start_ms: 100,
    end_ms: 400,
  });
  c.event({
    type: 'session.output_transcript.delta',
    delta: 'Made the tri',
    start_ms: 1500,
    end_ms: 2000,
  });
  c.event({
    type: 'session.output_transcript.delta',
    delta: 'angle! 3.',
    start_ms: 2000,
    end_ms: 2400,
  });
  c.event({
    type: 'session.output_transcript.delta',
    delta: '14',
    start_ms: 3000,
    end_ms: 3200,
  });
  expect(h.replies.at(-1)).toBe('OK. Made the triangle! 3.14');
  h.session.stop();
});

test('a result separates its completion from the acknowledgement even without transcript timestamps', async () => {
  const h = harness();
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.output_transcript.delta', delta: 'OK.' });
  h.session.reportFacts({ saved: true, result: 'Triangle drawn.' });
  c.event({
    type: 'session.output_transcript.delta',
    delta: 'Made the triangle!',
  });
  expect(h.replies.at(-1)).toBe('OK. Made the triangle!');
  h.session.stop();
});

test('unmuting continuous playback restores speaking without a new audio edge', async () => {
  const h = harness();
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.speaking.mockReturnValue(true);
  c.event({ type: 'playback.activity', active: true });
  h.session.setReplies(false);
  expect(h.playback.at(-1)).toBe(false);
  h.session.setReplies(true);
  expect(h.playback.at(-1)).toBe(true);
  h.session.stop();
});

test('independent delegations remain active together and return each confirmed save to its request', async () => {
  const completions = new Map<string, (value: unknown) => void>();
  const signals: AbortSignal[] = [];
  const h = harness(async (text, _id, signal) => {
    signals.push(signal!);
    return new Promise((resolve) => completions.set(text, resolve));
  });
  await h.start();
  await h.sound();
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  for (const [id, text] of [
    ['equation', 'write x equals four'],
    ['plot', 'plot x squared'],
  ]) {
    connection.event({ type: 'session.input_transcript.delta', delta: text });
    connection.event({
      type: 'session.delegation.created',
      delegation: { id, target: 'client' },
    });
  }
  expect(completions.size).toBe(2);
  expect(signals.every((signal) => !signal.aborted)).toBe(true);
  completions.get('plot x squared')!({
    status: 'command',
    saved: true,
    result: 'Graph saved.',
  });
  await vi.advanceTimersByTimeAsync(1);
  completions.get('write x equals four')!({
    status: 'command',
    saved: true,
    result: 'Equation saved.',
  });
  await vi.advanceTimersByTimeAsync(1);
  const replies = connection.send.mock.calls
    .map(([event]) => event)
    .filter((event) => event.type === 'session.commentary.append');
  expect(
    replies.map((event) => [
      event.delegation_id,
      JSON.parse(event.content).result,
    ]),
  ).toEqual([
    ['plot', 'Graph saved.'],
    ['equation', 'Equation saved.'],
  ]);
  expect(h.notices).toEqual([]);
  h.session.stop();
});

test('Record starts local audio before the server check and releases it if setup is unavailable', async () => {
  const h = harness();
  let configured!: (value: boolean) => void;
  h.environment.configured = () =>
    new Promise((resolve) => {
      configured = resolve;
    });
  const monitor = vi.spyOn(h.environment, 'monitor');
  h.session.toggle();
  expect(monitor).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.states.at(-1)).toBe('starting');
  configured(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.states.at(-1)).toBe('idle');
  expect(h.released).toHaveBeenCalledOnce();
  expect(h.notices.at(-1)).toMatch(/not set up/);
  h.session.stop();
});

test('first speech survives slow setup and provider connection without repetition', async () => {
  const h = harness();
  let configured!: (value: boolean) => void;
  h.environment.configured = () =>
    new Promise((resolve) => {
      configured = resolve;
    });
  const connect = h.environment.connect.bind(h.environment);
  let connected!: () => void;
  h.environment.connect = async (...args) => {
    const transport = await connect(...args);
    await new Promise<void>((resolve) => {
      connected = resolve;
    });
    return transport;
  };
  await h.start();
  await h.sound(0.01, 100);
  expect(h.connections).toHaveLength(0);
  configured(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.states.at(-1)).toBe('listening');
  expect(h.connections).toHaveLength(1);
  await h.sound(0.02, 60);
  expect(h.played).toHaveLength(0);
  connected();
  await vi.advanceTimersByTimeAsync(1);
  h.connections[0].event({ type: 'session.started' });
  expect(h.played).toHaveLength(8);
  expect(
    h.played
      .slice(0, 5)
      .every((frame) => Math.abs(frame.samples[0] - 0.01) < 1e-6),
  ).toBe(true);
  expect(
    h.played
      .slice(5)
      .every((frame) => Math.abs(frame.samples[0] - 0.02) < 1e-6),
  ).toBe(true);
  h.session.stop();
});

test('turning off the mic releases input while delegated work and its spoken result continue', async () => {
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  const h = harness(async (_text, _id, activeSignal) => {
    signal = activeSignal!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.input_transcript.delta', delta: 'plot x squared' });
  c.event({
    type: 'session.delegation.created',
    delegation: { id: 'plot', target: 'client' },
  });
  h.session.stopListening();
  expect(h.states.at(-1)).toBe('idle');
  expect(h.released).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(false);
  finish({ status: 'command', saved: true, result: 'Graph saved.' });
  await vi.advanceTimersByTimeAsync(1);
  expect(
    c.send.mock.calls.some(
      ([e]) =>
        e.type === 'session.commentary.append' &&
        JSON.parse(e.content).result === 'Graph saved.',
    ),
  ).toBe(true);
  c.event({ type: 'session.output_transcript.delta', delta: 'Graph saved.' });
  c.event({ type: 'playback.activity', active: true });
  expect(h.replies.at(-1)).toBe('Graph saved.');
  expect(h.playback.at(-1)).toBe(true);
  h.session.stop();
});

test('the mic can restart during delegated work without cancelling it or losing the original reply', async () => {
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  const h = harness(async (_text, _id, activeSignal) => {
    signal = activeSignal!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const originalConnect = h.environment.connect.bind(h.environment);
  const replaceCapture = vi.fn(async () => {});
  h.environment.connect = async (...args) => ({
    ...(await originalConnect(...args)),
    replaceCapture,
  });
  await h.start();
  await h.sound();
  const c = h.connections[0];
  c.event({ type: 'session.started' });
  c.event({ type: 'session.input_transcript.delta', delta: 'plot x squared' });
  c.event({
    type: 'session.delegation.created',
    delegation: { id: 'plot', target: 'client' },
  });
  h.session.stopListening();
  h.session.toggle();
  await vi.advanceTimersByTimeAsync(1);
  expect(replaceCapture).toHaveBeenCalledOnce();
  expect(h.states.at(-1)).toBe('listening');
  expect(signal.aborted).toBe(false);
  finish({ saved: true, result: 'Graph saved.' });
  await vi.advanceTimersByTimeAsync(1);
  expect(
    c.send.mock.calls.some(([e]) => e.type === 'session.commentary.append'),
  ).toBe(true);
  expect(h.connections).toHaveLength(1);
  h.session.stop();
});

test('resuming tone playback does not reactivate a stopped microphone', async () => {
  const h = harness();
  await h.start();
  h.session.stopListening();
  h.session.pause();
  h.session.resume();
  expect(h.states.at(-1)).toBe('idle');
  h.session.stop();
});

test('full shutdown during microphone track replacement releases the new capture', async () => {
  const h = harness();
  const originalConnect = h.environment.connect.bind(h.environment);
  let replace!: () => void;
  h.environment.connect = async (...args) => ({
    ...(await originalConnect(...args)),
    replaceCapture: () =>
      new Promise<void>((resolve) => {
        replace = resolve;
      }),
  });
  await h.start();
  await h.sound();
  h.connections[0].event({ type: 'session.started' });
  h.session.stopListening();
  h.session.toggle();
  await vi.advanceTimersByTimeAsync(1);
  h.session.stop();
  replace();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.states.at(-1)).toBe('idle');
  expect(h.released.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('mic restart during a pending connection attaches fresh input to the eventual transport', async () => {
  const h = harness();
  const originalConnect = h.environment.connect.bind(h.environment);
  let finish!: () => void;
  const replaceCapture = vi.fn(async () => {});
  h.environment.connect = async (...args) => {
    const transport = await originalConnect(...args);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { ...transport, replaceCapture };
  };
  await h.start();
  await h.sound();
  h.session.stopListening();
  h.session.toggle();
  await vi.advanceTimersByTimeAsync(1);
  finish();
  await vi.advanceTimersByTimeAsync(1);
  expect(replaceCapture).toHaveBeenCalledOnce();
  expect(h.states.at(-1)).toBe('listening');
  h.session.stop();
});

test('untranscribed speech is replayed once on a fresh connection without repeating an action', async () => {
  const execute = vi.fn(async (_text: string) => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound(0.02, 200);
  const first = h.connections[0];
  first.event({ type: 'session.started' });
  const originalSpeech = h.played.filter((frame) => frame.samples[0] > 0);
  await h.sound(0, 5100);
  first.event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.connections).toHaveLength(2);
  const retry = h.connections[1];
  const beforeReplay = h.played.length;
  retry.event({ type: 'session.started' });
  expect(
    h.played
      .slice(beforeReplay)
      .filter((frame) => frame.samples[0] > 0)
      .map((frame) => frame.at),
  ).toEqual(originalSpeech.map((frame) => frame.at));
  retry.event({
    type: 'session.input_transcript.delta',
    delta: 'write 2*x+3=11',
  });
  retry.event({
    type: 'session.delegation.created',
    delegation: { id: 'recovered', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  first.event({
    type: 'session.delegation.created',
    delegation: { id: 'stale', target: 'client' },
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[0]).toBe('write 2*x+3=11');
  h.session.stop();
});

test('a second missing transcript stops recovery and explains that no action was taken', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound(0.02, 200);
  h.connections[0].event({ type: 'session.started' });
  await h.sound(0, 5100);
  h.connections[0].event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  h.connections[1].event({ type: 'session.started' });
  await h.sound(0, 7000);
  expect(h.notices.at(-1)).toContain(
    'Please repeat your request. No action was taken.',
  );
  h.connections[1].event({ type: 'session.closed' });
  await h.sound(0, 6000);
  expect(h.connections).toHaveLength(2);
  expect(execute).not.toHaveBeenCalled();
  await h.sound(0.02, 100);
  expect(h.connections).toHaveLength(3);
  h.connections[2].event({ type: 'session.started' });
  h.connections[2].event({
    type: 'session.input_transcript.delta',
    delta: 'write x=4',
  });
  expect(h.notices.at(-1)).toBe('');
  h.session.stop();
});

test.each(['stop', 'stopListening', 'pause'] as const)(
  '%s discards unheard audio instead of replaying it',
  async (action) => {
    const h = harness();
    await h.start();
    await h.sound(0.02, 200);
    h.connections[0].event({ type: 'session.started' });
    h.session[action]();
    await vi.advanceTimersByTimeAsync(6000);
    h.connections[0].event({ type: 'session.closed' });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.connections).toHaveLength(1);
    expect(h.notices.some((text) => text.includes('Trying your audio'))).toBe(
      false,
    );
    h.session.stop();
  },
);

test('speech beyond the recovery limit is never replayed as a truncated request', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound(0.02, 100);
  h.connections[0].event({ type: 'session.started' });
  await h.sound(0.02, 13000);
  await h.sound(0, 5100);
  expect(h.notices.at(-1)).toContain(
    'Please repeat your request. No action was taken.',
  );
  h.connections[0].event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.connections).toHaveLength(1);
  expect(execute).not.toHaveBeenCalled();
  h.session.stop();
});

test('stopping while unheard-audio recovery is closing the old connection cancels the replay', async () => {
  const h = harness();
  await h.start();
  await h.sound(0.02, 200);
  h.connections[0].event({ type: 'session.started' });
  await h.sound(0, 5100);
  expect(
    h.connections[0].send.mock.calls.some(
      ([event]) => event.type === 'session.close',
    ),
  ).toBe(true);
  h.session.stop();
  h.connections[0].event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.connections).toHaveLength(1);
});

test('a transcribed and executed request is never replayed after silence', async () => {
  const execute = vi.fn(async () => ({ saved: true }));
  const h = harness(execute);
  await h.start();
  await h.sound(0.02, 200);
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  connection.event({
    type: 'session.input_transcript.delta',
    delta: 'write x=4',
  });
  connection.event({
    type: 'session.delegation.created',
    delegation: { id: 'accepted', target: 'client' },
  });
  await vi.advanceTimersByTimeAsync(1);
  for (const [event] of connection.send.mock.calls)
    if (event.type === 'session.commentary.append')
      connection.event({
        type: 'session.commentary.appended',
        client_event_id: event.event_id,
      });
  await h.sound(0, 5100);
  connection.event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.connections).toHaveLength(1);
  expect(execute).toHaveBeenCalledOnce();
  expect(h.notices.some((text) => text.includes('Trying your audio'))).toBe(
    false,
  );
  h.session.stop();
});

test('an unexpected provider closure retries unheard audio once and does not reopen indefinitely', async () => {
  const h = harness();
  await h.start();
  await h.sound(0.02, 200);
  h.connections[0].event({ type: 'session.started' });
  h.connections[0].event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  h.connections[1].event({ type: 'session.started' });
  expect(h.played.filter((frame) => frame.samples[0] > 0)).toHaveLength(20);
  h.connections[1].event({ type: 'session.closed' });
  await vi.advanceTimersByTimeAsync(1);
  expect(h.connections).toHaveLength(2);
  expect(h.notices.at(-1)).toContain(
    'Please repeat your request. No action was taken.',
  );
  h.session.stop();
});

test('dispatches each new Live delegation before earlier work completes', async () => {
  const finishes: ((value: unknown) => void)[] = [];
  const execute = vi.fn(
    (_text: string, _id: string, _signal?: AbortSignal) =>
      new Promise((resolve) => finishes.push(resolve)),
  );
  const h = harness(execute);
  await h.start();
  await h.sound();
  const connection = h.connections[0];
  connection.event({ type: 'session.started' });
  for (const [id, text] of [
    ['first', 'write h squared equals 25'],
    ['second', 'take the square root'],
  ]) {
    connection.event({ type: 'session.input_transcript.delta', delta: text });
    connection.event({
      type: 'session.delegation.created',
      delegation: { id, target: 'client' },
    });
  }
  expect(execute.mock.calls.map(([text]) => text)).toEqual([
    'write h squared equals 25',
    'take the square root',
  ]);
  expect(
    connection.send.mock.calls.filter(
      ([event]) => event.type === 'session.commentary.append',
    ),
  ).toHaveLength(0);
  finishes[0]({ saved: true });
  finishes[1]({ saved: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(
    connection.send.mock.calls.filter(
      ([event]) => event.type === 'session.commentary.append',
    ),
  ).toHaveLength(2);
  h.session.stop();
});

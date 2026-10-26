import { test, vi, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { VoiceSession, type Recognition, type VoiceState } from '../index.ts';
function fixture(fails = false) {
  const states: VoiceState[] = [],
    errors: string[] = [],
    commands: string[] = [],
    instances: Recognition[] = [];
  const session = new VoiceSession(
    () => {
      const r: Recognition = {
        lang: '',
        continuous: false,
        interimResults: false,
        onstart: null,
        onresult: null,
        onend: null,
        onerror: null,
        start() {
          if (fails) throw new Error('Device unavailable');
        },
        abort() {},
      };
      instances.push(r);
      return r;
    },
    {
      state: (s) => states.push(s),
      error: (s) => errors.push(s),
      command: (s) => commands.push(s),
      partial: () => {},
    },
  );
  return { session, states, errors, commands, instances };
}
test('recording is only active after engine startup; startup can be cancelled', () => {
  const f = fixture();
  f.session.toggle();
  assert.deepEqual(f.states, ['starting']);
  const late = f.instances[0].onstart!;
  f.session.stop();
  late();
  assert.equal(f.states.at(-1), 'idle');
  f.session.toggle();
  f.instances[1].onstart!();
  assert.equal(f.states.at(-1), 'listening');
  f.session.stop();
});
test('startup exception is visible and does not leave recording on', () => {
  const f = fixture(true);
  f.session.toggle();
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /Device unavailable/);
});
test('late errors and transcripts from a stopped session cannot affect restart', () => {
  const f = fixture();
  f.session.toggle();
  const old = f.instances[0],
    error = old.onerror!,
    result = old.onresult!;
  f.session.stop();
  f.session.toggle();
  f.instances[1].onstart!();
  error({ error: 'network' });
  result({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: 'bad late result' } }],
  });
  assert.equal(f.states.at(-1), 'listening');
  assert.equal(f.errors.length, 0);
  assert.equal(f.commands.length, 0);
  f.session.stop();
});
test('playback pauses capture and resumes using a new recognition session', () => {
  const f = fixture();
  f.session.toggle();
  f.instances[0].onstart!();
  f.session.pause();
  assert.equal(f.states.at(-1), 'paused');
  f.session.resume();
  assert.equal(f.instances.length, 2);
  f.instances[1].onstart!();
  assert.equal(f.states.at(-1), 'listening');
  f.session.stop();
});

test('a repeated final recognition event cannot apply an operation twice', () => {
  const f = fixture();
  f.session.toggle();
  const r = f.instances[0];
  r.onstart!();
  const event = {
    resultIndex: 0,
    results: [
      { isFinal: true, 0: { transcript: 'subtract three from both sides' } },
    ],
  };
  r.onresult!(event);
  r.onresult!(event);
  assert.deepEqual(f.commands, ['subtract three from both sides']);
  f.session.stop();
});

test('microphone denial returns to idle and cannot receive late commands', () => {
  const f = fixture();
  f.session.toggle();
  const r = f.instances[0];
  const late = r.onresult!;
  r.onerror!({ error: 'not-allowed' });
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /denied.*work is kept/i);
  late({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: 'replace x with zero' } }],
  });
  assert.equal(f.commands.length, 0);
});

test('silence does not flash recording off or emit a command', () => {
  const f = fixture();
  f.session.toggle();
  const r = f.instances[0];
  r.onstart!();
  r.onerror!({ error: 'no-speech' });
  assert.equal(f.states.at(-1), 'listening');
  assert.equal(f.commands.length, 0);
  assert.equal(f.errors.length, 0);
  f.session.stop();
});

test('permission preflight releases capture before recognition starts', async () => {
  const f = fixture();
  let released = false;
  const session = new VoiceSession(
    () => {
      assert.equal(released, true);
      return f.instances[0];
    },
    {
      state: (s) => f.states.push(s),
      partial: () => {},
      command: () => {},
      error: (s) => f.errors.push(s),
    },
    async () => () => {
      released = true;
    },
  );
  // Supply a recognizer without starting a second live session.
  f.session.toggle();
  f.session.stop();
  session.toggle();
  assert.equal(f.states.at(-1), 'starting');
  await Promise.resolve();
  assert.equal(released, true);
  f.instances[0].onstart!();
  assert.equal(f.states.at(-1), 'listening');
  session.stop();
});

test('cancelled permission requests release late capture without starting recognition', async () => {
  let resolve!: (release: () => void) => void;
  let released = 0,
    created = 0;
  const f = fixture();
  const session = new VoiceSession(
    () => {
      created++;
      return f.instances[0];
    },
    {
      state: (s) => f.states.push(s),
      partial: () => {},
      command: () => {},
      error: (s) => f.errors.push(s),
    },
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  session.toggle();
  session.stop();
  resolve(() => {
    released++;
  });
  await Promise.resolve();
  assert.equal(released, 1);
  assert.equal(created, 0);
  assert.equal(f.states.at(-1), 'idle');
});

test('permission rejection reports its cause and allows retry', async () => {
  const f = fixture();
  const session = new VoiceSession(
    () => f.instances[0],
    {
      state: (s) => f.states.push(s),
      partial: () => {},
      command: () => {},
      error: (s) => f.errors.push(s),
    },
    async () => {
      throw new Error('Microphone access was denied.');
    },
  );
  session.toggle();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /denied.*work is kept/);
  session.toggle();
  assert.equal(f.states.at(-1), 'starting');
  session.stop();
});

test('a speech-service timeout after successful capture names the service, not permissions', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.session.toggle();
  f.session.stop();
  const session = new VoiceSession(
    () => f.instances[0],
    {
      state: (s) => f.states.push(s),
      partial: () => {},
      command: () => {},
      error: (s) => f.errors.push(s),
    },
    async () => () => {},
  );
  session.toggle();
  await Promise.resolve();
  vi.advanceTimersByTime(15000);
  assert.equal(f.states.at(-1), 'idle');
  assert.match(
    f.errors[0],
    /microphone is available.*speech service did not start/,
  );
  assert.match(f.errors[0], /Google Chrome/);
});

test('an unanswered permission prompt times out and cleans up a late stream', async () => {
  vi.useFakeTimers();
  const f = fixture();
  let resolve!: (release: () => void) => void;
  let releases = 0,
    created = 0;
  const session = new VoiceSession(
    () => {
      created++;
      return f.instances[0];
    },
    {
      state: (s) => f.states.push(s),
      partial: () => {},
      command: () => {},
      error: (s) => f.errors.push(s),
    },
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  session.toggle();
  vi.advanceTimersByTime(60000);
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /permission is still pending/);
  resolve(() => {
    releases++;
  });
  await Promise.resolve();
  assert.equal(releases, 1);
  assert.equal(created, 0);
});

test('a blocked speech service is distinct from a denied microphone', () => {
  const f = fixture();
  f.session.toggle();
  f.instances[0].onerror!({ error: 'service-not-allowed' });
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /speech service.*Google Chrome/);
  assert.doesNotMatch(f.errors[0], /Microphone access was denied/);
});

test('the selected accent is applied to every browser recognition restart', () => {
  const f = fixture();
  f.session.toggle();
  f.session.stop();
  const session = new VoiceSession(
    () => f.instances[0],
    {
      state: (s) => f.states.push(s),
      partial: () => {},
      command: () => {},
      error: (s) => f.errors.push(s),
    },
    undefined,
    'en-GB',
  );
  session.toggle();
  assert.equal(f.instances[0].lang, 'en-GB');
  session.pause();
  session.resume();
  assert.equal(f.instances[0].lang, 'en-GB');
  session.stop();
});

afterEach(() => vi.useRealTimers());

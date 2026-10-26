import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OpenAIVoiceSession } from '../index.ts';
test('missing OpenAI key returns to idle without falsely showing listening', async () => {
  const original = globalThis.fetch;
  const states: string[] = [],
    errors: string[] = [];
  globalThis.fetch = async () =>
    Response.json({ error: 'OpenAI key missing' }, { status: 503 });
  const session = new OpenAIVoiceSession(
    {
      state: (s) => states.push(s),
      partial: () => {},
      error: (s) => errors.push(s),
      notice: () => {},
      context: () => ({ revision: '1', workspace: {} }),
      interpret: () => {
        throw new Error('Should not interpret');
      },
    },
    {
      configured: async () => false,
      monitor: async () => {
        return {
          stream: {} as MediaStream,
          play() {},
          draining: () => false,
          close() {},
        };
      },
      connect: async () => {
        throw new Error('Should not connect');
      },
    },
  );
  try {
    session.toggle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(states, ['starting', 'idle']);
    assert.deepEqual(errors, [
      'Voice is not set up yet. Your saved problems are available in Settings.',
    ]);
  } finally {
    session.stop();
    globalThis.fetch = original;
  }
});
test('cancelling startup ignores a late token response and does not resume listening', async () => {
  const original = globalThis.fetch;
  let resolve!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise((r) => {
      resolve = r;
    });
  const states: string[] = [],
    errors: string[] = [];
  const session = new OpenAIVoiceSession(
    {
      state: (s) => states.push(s),
      partial: () => {},
      error: (s) => errors.push(s),
      notice: () => {},
      context: () => ({ revision: '1', workspace: {} }),
      interpret: () => '',
    },
    {
      configured: async () => (await globalThis.fetch('/api/live-token')).ok,
      monitor: async () => {
        return {
          stream: {} as MediaStream,
          play() {},
          draining: () => false,
          close() {},
        };
      },
      connect: async () => {
        throw new Error('Should not connect');
      },
    },
  );
  try {
    session.toggle();
    session.stop();
    resolve(Response.json({ token: 'test-only-token' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(states.at(-1), 'idle');
    assert.ok(!states.includes('listening'));
    assert.deepEqual(errors, []);
  } finally {
    session.stop();
    globalThis.fetch = original;
  }
});

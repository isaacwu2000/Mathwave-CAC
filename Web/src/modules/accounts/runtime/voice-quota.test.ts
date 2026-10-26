import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const ledger = vi.hoisted(() => ({
  remaining: 30000,
  settled: new Map<string, number>(),
}));
vi.mock('cloudflare:workers', () => ({
  env: { OPENAI_API_KEY: 'synthetic' },
  DurableObject: class {
    ctx: DurableObjectState;
    constructor(ctx: DurableObjectState) {
      this.ctx = ctx;
    }
  },
}));
vi.mock('../repo/database.ts', () => ({
  accountDatabase: () => async () => [],
}));
vi.mock('../repo/quota-store.ts', () => ({
  createQuotaStore: () => ({
    async reserve(
      _owner: string,
      _period: string,
      _ip: string | null,
      _ipPeriod: string | null,
      requested: number,
    ) {
      const milliseconds = Math.min(ledger.remaining, requested);
      if (!milliseconds) return null;
      ledger.remaining -= milliseconds;
      return { id: crypto.randomUUID(), milliseconds };
    },
    async progress() {},
    async settle(id: string, milliseconds: number) {
      if (!ledger.settled.has(id)) ledger.settled.set(id, milliseconds);
    },
  }),
}));
import { VoiceQuota } from './voice-quota.ts';

function harness(attachFails = false) {
  const values = new Map<string, unknown>();
  const pending: Promise<unknown>[] = [];
  const sent: { type: string }[] = [];
  const socket = new EventTarget() as WebSocket;
  socket.accept = () => {};
  socket.send = (raw) => {
    if (typeof raw === 'string') sent.push(JSON.parse(raw));
  };
  socket.close = () => {};
  const storage = {
    async get(key: string) {
      return structuredClone(values.get(key));
    },
    async put(key: string, value: unknown) {
      values.set(key, structuredClone(value));
    },
    async setAlarm() {},
    async deleteAlarm() {},
  };
  let gate: Promise<unknown> = Promise.resolve();
  const context = {
    id: { toString: () => 'synthetic-actor' },
    blockConcurrencyWhile: (work: () => Promise<unknown>) => {
      const result = gate.then(work);
      gate = result.catch(() => {});
      return result;
    },
    storage,
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as DurableObjectState;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/attach')) {
        if (attachFails) throw new Error('Synthetic attachment failure');
        return Object.assign(new Response(), { webSocket: socket });
      }
      return Response.json({
        session: { id: 'live_synthetic' },
        transport: { sdp: 'v=0 synthetic answer' },
      });
    }),
  );
  const actor = new VoiceQuota(context, {});
  return {
    actor,
    context,
    sent,
    values,
    pending,
    socket,
    start: () =>
      actor.fetch(
        new Request('https://voice.internal/start', {
          method: 'POST',
          body: JSON.stringify({
            access: {
              owner: 'guest:test',
              period: 'trial',
              ip: null,
              ipPeriod: null,
            },
            providerBody: {},
          }),
        }),
      ),
    async emit(event: unknown) {
      socket.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify(event) }),
      );
      await Promise.all(pending.splice(0));
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  ledger.remaining = 30000;
  ledger.settled.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('server alarms close paid voice at exhaustion even when the browser sends no quota events', async () => {
  const h = harness();
  expect((await h.start()).status).toBe(200);
  await vi.advanceTimersByTimeAsync(10000);
  await h.actor.alarm();
  await vi.advanceTimersByTimeAsync(10000);
  await h.actor.alarm();
  expect(h.sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(10000);
  await h.actor.alarm();
  expect(h.sent).toContainEqual({ type: 'session.close' });
  await h.emit({ type: 'session.closed', usage: { seconds: 30 } });
  await h.emit({ type: 'session.closed', usage: { seconds: 30 } });
  expect([...ledger.settled.values()].reduce((a, b) => a + b, 0)).toBe(30000);
});

test('restoring an evicted actor retains the original reserved deadline', async () => {
  const h = harness();
  await h.start();
  const restored = new VoiceQuota(h.context, {});
  await vi.advanceTimersByTimeAsync(30000);
  await restored.alarm();
  // A late wake cannot manufacture time. A finite final grant is still enforced.
  await vi.advanceTimersByTimeAsync(10000);
  await restored.alarm();
  expect(h.sent).toContainEqual({ type: 'session.close' });
});

test('a failed server usage monitor never releases a usable voice answer to the browser', async () => {
  const h = harness(true);
  expect((await h.start()).status).toBe(503);
  expect(ledger.settled.size).toBe(0);
});

test('concurrent starts create only one paid provider connection', async () => {
  const h = harness();
  const responses = await Promise.all([h.start(), h.start()]);
  expect(responses.map((response) => response.status)).toEqual([200, 409]);
  expect(ledger.remaining).toBe(10000);
});

import { expect, test } from 'vitest';
import { CloudProblemLibraryClient } from './cloud-client.ts';
import { createProblemLibrary } from '../services/problem-library.ts';
import { applyCloudOperation } from '../services/cloud-problem-library.ts';

test('starting a new problem recovers a lost save response and preserves the previous work', async () => {
  let saved = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const receipts = new Map<string, unknown>();
  let loseResponse = true;
  const client = new CloudProblemLibraryClient(async (_url, init) => {
    if (!init?.body) return Response.json(saved);
    if (typeof init.body !== 'string') throw new Error('Expected JSON body');
    const request = JSON.parse(init.body);
    if (receipts.has(request.id))
      return Response.json(receipts.get(request.id));
    expect(request.revision).toBe(saved.revision);
    const outcome = await applyCloudOperation(saved, request.operation);
    saved = { ...outcome, clarification: null, revision: saved.revision + 1 };
    receipts.set(request.id, saved);
    if (loseResponse) {
      loseResponse = false;
      throw new Error('Lost response after commit');
    }
    return Response.json(saved);
  });
  await client.load();
  await expect(
    client.apply({ kind: 'command', text: 'write x=4' }),
  ).rejects.toThrow('Lost response');
  const next = await client.apply({ kind: 'new' });
  expect(next.book.assignments[0].problems).toHaveLength(2);
  expect(next.book.assignments[0].problems[0].steps).toHaveLength(1);
  expect(next.book.assignments[0].problems[0].state.expression).toBe('x = 4');
  expect(next.revision).toBe(2);
  expect(client.saveUnconfirmed).toBe(false);
});
test('an uncertain cloud save retries its original request instead of duplicating a command', async () => {
  const snapshot = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const bodies: string[] = [];
  let lost = true;
  const client = new CloudProblemLibraryClient(async (_url, init) => {
    if (!init?.body) return Response.json(snapshot);
    if (typeof init.body !== 'string') throw new Error('Expected JSON body');
    bodies.push(init.body);
    if (lost) {
      lost = false;
      throw new Error('Lost response after commit');
    }
    return Response.json({
      ...snapshot,
      revision: 1,
      status: 'command',
      message: 'Saved',
    });
  });
  await client.load();
  await expect(
    client.apply({ kind: 'command', text: 'write x=4' }),
  ).rejects.toThrow('Lost response');
  await client.retry();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(client.snapshot?.revision).toBe(1);
});
test('a revision conflict blocks new edits until the cloud problem is explicitly reloaded', async () => {
  const saved = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const client = new CloudProblemLibraryClient(async (_url, init) =>
    init?.body
      ? Response.json(
          {
            error: 'ProblemLibrary changed',
            snapshot: { ...saved, revision: 1 },
          },
          { status: 409 },
        )
      : Response.json(saved),
  );
  await client.load();
  await expect(
    client.apply({ kind: 'command', text: 'write x=4' }),
  ).rejects.toThrow('ProblemLibrary changed');
  await expect(
    client.apply({ kind: 'command', text: 'add five' }),
  ).rejects.toThrow('Reload');
  await client.retry();
  expect(client.snapshot?.revision).toBe(0);
});

test('a reloaded tab confirms its retained request before loading the problem', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const snapshot = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const bodies: string[] = [];
  let offline = true;
  const transport = async (_url: string, init?: RequestInit) => {
    if (!init?.body) return Response.json(snapshot);
    if (typeof init.body !== 'string') throw new Error('Expected JSON body');
    bodies.push(init.body);
    if (offline) throw new Error('Server disconnected');
    const request = JSON.parse(init.body);
    return Response.json({
      ...snapshot,
      revision: request.revision + 1,
      status: 'command',
      message: 'Saved',
    });
  };
  const first = new CloudProblemLibraryClient(transport, storage);
  await first.load();
  await expect(first.apply({ kind: 'new' })).rejects.toThrow(
    'Server disconnected',
  );
  offline = false;
  const reloaded = new CloudProblemLibraryClient(transport, storage);
  await reloaded.load();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(reloaded.saveUnconfirmed).toBe(false);
  expect(values.size).toBe(0);
});

test('an offline retry preserves the pending save and never sends the next problem', async () => {
  const snapshot = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const bodies: string[] = [];
  const client = new CloudProblemLibraryClient(async (_url, init) => {
    if (!init?.body) return Response.json(snapshot);
    if (typeof init.body !== 'string') throw new Error('Expected JSON body');
    bodies.push(init.body);
    throw new Error('Offline');
  });
  await client.load();
  await expect(
    client.apply({ kind: 'command', text: 'write x=4' }),
  ).rejects.toThrow('Offline');
  await expect(client.apply({ kind: 'new' })).rejects.toThrow('Offline');
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(client.saveUnconfirmed).toBe(true);
  expect(client.snapshot?.revision).toBe(0);
});

test('network failure retains the retry and records the failed request duration', async () => {
  performance.clearMeasures();
  const client = new CloudProblemLibraryClient(async (_url, init) => {
    if (init?.method === 'POST') throw new Error('Network unavailable');
    return Response.json({
      book: createProblemLibrary(),
      clarification: null,
      revision: 0,
    });
  });
  await client.load();
  await expect(
    client.apply({ kind: 'command', text: 'write x=4' }, 'failed-timing'),
  ).rejects.toThrow('Network unavailable');
  const entries = performance.getEntriesByType(
    'measure',
  ) as PerformanceMeasure[];
  expect(
    entries
      .filter((e) => e.detail?.id === 'failed-timing')
      .map((e) => e.detail.stage),
  ).toEqual(expect.arrayContaining(['request-failed', 'request-body']));
  expect(client.saveUnconfirmed).toBe(true);
});

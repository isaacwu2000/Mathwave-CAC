import { expect, test, vi } from 'vitest';
import { createProblemLibraryApi } from './cloud-api.ts';
import { CloudProblemLibraryClient } from './cloud-client.ts';
import {
  createProblemLibrary,
  currentProblem,
} from '../services/problem-library.ts';
import type { CloudSnapshot, Receipt } from '../types/cloud-api.ts';
import type {
  InterpretationProgress,
  Interpreter,
} from '../types/cloud-problem-library.ts';

function harness(
  interpret: Interpreter,
  loseFinal = false,
  commitGate = Promise.resolve(),
) {
  let saved: CloudSnapshot = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const receipts = new Map<string, Receipt>();
  const api = createProblemLibraryApi({
    owner: async () => 'synthetic',
    interpret,
    store: {
      load: async () => saved,
      receipt: async (_owner, id) => receipts.get(id) ?? null,
      commit: async (_owner, id, revision, outcome, request) => {
        await commitGate;
        if (saved.revision !== revision) return false;
        saved = { ...outcome, revision: revision + 1 };
        receipts.set(id, {
          request,
          result: { ...outcome, revision: revision + 1 },
        });
        return true;
      },
    },
  });
  const client = new CloudProblemLibraryClient(async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', 'https://math.example');
    const request = new Request(`https://math.example${url}`, {
      ...init,
      headers,
    });
    const result =
      init?.method === 'POST'
        ? await api.POST(request)
        : await api.GET(request);
    if (
      loseFinal &&
      result.headers.get('Content-Type')?.includes('application/x-ndjson')
    ) {
      loseFinal = false;
      const reader = result.body!.getReader();
      return new Response(
        new ReadableStream({
          async pull(controller) {
            const chunk = await reader.read();
            if (chunk.done) {
              controller.close();
              return;
            }
            if (
              new TextDecoder().decode(chunk.value).includes('"type":"result"')
            ) {
              controller.close();
              await reader.cancel();
            } else controller.enqueue(chunk.value);
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    }
    return result;
  });
  return { client, saved: () => saved };
}

test('temporary math is delivered before checking finishes and never becomes a saved snapshot', async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let observed!: () => void;
  const seen = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const h = harness(async (_text, saved, _timing, progress) => {
    progress?.({
      phase: 'checking',
      workspace: { ...currentProblem(saved.book).state, expression: 'x = 4' },
    });
    await gate;
    progress?.({ phase: 'fixing' });
    return { status: 'command', command: 'write x=5', message: '' };
  });
  await h.client.load();
  const updates: InterpretationProgress[] = [];
  const pending = h.client.apply(
    { kind: 'command', text: 'put x equal to four', interpret: true },
    'progress',
    undefined,
    (value) => {
      updates.push(value);
      observed();
    },
  );
  await seen;
  expect(updates[0].workspace?.expression).toBe('x = 4');
  expect(h.saved().revision).toBe(0);
  expect(h.client.snapshot?.revision).toBe(0);
  expect(currentProblem(h.saved().book).steps).toHaveLength(0);
  finish();
  const result = await pending;
  expect(updates.some((value) => value.phase === 'fixing')).toBe(true);
  expect(updates.at(-1)?.workspace?.expression).toBe('x = 5');
  expect(currentProblem(result.book).state.expression).toBe('x = 5');
  expect(result.revision).toBe(1);
});

test('a normal proposal is visible while persistence is delayed, without an optional preview tool call', async () => {
  let finish!: () => void, observed!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const h = harness(
    async () => ({ status: 'command', command: 'write x=4', message: '' }),
    false,
    commitGate,
  );
  await h.client.load();
  const updates: InterpretationProgress[] = [];
  const pending = h.client.apply(
    { kind: 'command', text: 'put x equal to four', interpret: true },
    'normal',
    undefined,
    (value) => {
      updates.push(value);
      observed();
    },
  );
  await seen;
  expect(updates).toEqual([
    {
      phase: 'checking',
      workspace: expect.objectContaining({ expression: 'x = 4' }),
    },
  ]);
  expect(h.saved().revision).toBe(0);
  expect(h.client.snapshot?.revision).toBe(0);
  finish();
  expect((await pending).revision).toBe(1);
});

test('a dropped final frame stays unconfirmed and retries the original receipt without reinterpreting', async () => {
  const interpret = vi.fn(async () => ({
    status: 'command' as const,
    command: 'write x=4',
    message: '',
  }));
  const h = harness(interpret, true);
  await h.client.load();
  await expect(
    h.client.apply(
      { kind: 'command', text: 'put x equal to four', interpret: true },
      'lost',
      undefined,
      () => {},
    ),
  ).rejects.toThrow('before saving');
  expect(h.client.saveUnconfirmed).toBe(true);
  expect(h.client.snapshot?.revision).toBe(0);
  expect(h.saved().revision).toBe(1);
  await h.client.retry();
  expect(interpret).toHaveBeenCalledOnce();
  expect(h.client.snapshot?.revision).toBe(1);
  expect(h.client.saveUnconfirmed).toBe(false);
});

test('explicit math bypasses AI and preview while clarification context keeps the interpreter', async () => {
  const interpret = vi.fn(async () => ({
    status: 'clarification' as const,
    command: '',
    message: 'Which equation?',
  }));
  const h = harness(interpret);
  await h.client.load();
  const updates = vi.fn();
  const result = await h.client.apply(
    {
      kind: 'command',
      text: 'Write two x plus three equals eleven.',
      interpret: true,
    },
    'direct',
    undefined,
    updates,
  );
  expect(currentProblem(result.book).state.expression).toBe('2 * x + 3 = 11');
  expect(interpret).not.toHaveBeenCalled();
  expect(updates).not.toHaveBeenCalled();
  h.saved().clarification = {
    request: 'put x equal to four',
    question: 'Which value?',
  };
  await h.client.load();
  await h.client.apply(
    { kind: 'command', text: 'write x=6', interpret: true },
    'clarification',
  );
  expect(interpret).toHaveBeenCalledOnce();
});

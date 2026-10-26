import { expect, test, vi } from 'vitest';
import {
  createProblemLibraryApi,
  type ProblemLibraryStore,
  type CloudSnapshot,
  type Receipt,
} from './cloud-api.ts';
import { createProblemLibrary, currentProblem, recordStep } from '../index.ts';
import { runCommand } from '../../commands/index.ts';

function harness() {
  const rows = new Map<string, CloudSnapshot>();
  const receipts = new Map<string, Receipt>();
  const store: ProblemLibraryStore = {
    async load(owner) {
      if (!rows.has(owner))
        rows.set(owner, {
          book: createProblemLibrary(),
          clarification: null,
          revision: 0,
        });
      return structuredClone(rows.get(owner)!);
    },
    async receipt(owner, id) {
      return receipts.get(`${owner}:${id}`) ?? null;
    },
    async commit(owner, id, revision, outcome, request) {
      if (rows.get(owner)!.revision !== revision) return false;
      const next = { ...outcome, revision: revision + 1 };
      rows.set(owner, structuredClone(next));
      receipts.set(`${owner}:${id}`, {
        request,
        result: structuredClone(next),
      });
      return true;
    },
  };
  const api = createProblemLibraryApi({
    store,
    owner: async (request) => {
      const user = request.headers.get('authorization');
      if (!user) throw new Response(null, { status: 401 });
      return user;
    },
  });
  const command = (
    owner: string,
    id: string,
    revision: number,
    text = 'write 2*x+3=11',
  ) =>
    api.POST(
      new Request('https://math.example/api/problems', {
        method: 'POST',
        headers: { origin: 'https://math.example', authorization: owner },
        body: JSON.stringify({
          id,
          revision,
          operation: {
            kind: 'command',
            text,
            interpret: false,
          },
          state: { expression: 'evil' },
        }),
      }),
    );
  return { api, command, rows, receipts, store };
}

function legacyBook() {
  let book = createProblemLibrary();
  for (const command of [
    'graph x+1',
    'view x -9 to 9 y -9 to 9',
    'write x=2',
    'view x -8 to 8 y -8 to 8',
    'write x=3',
  ])
    book = recordStep(
      book,
      runCommand(currentProblem(book).state, command).state,
      command,
    );
  return book;
}
const readRequest = () =>
  new Request('https://math.example/api/problems', {
    headers: { authorization: 'student-a' },
  });
function mutationRequest(id: string, revision: number, operation: unknown) {
  return new Request('https://math.example/api/problems', {
    method: 'POST',
    headers: { origin: 'https://math.example', authorization: 'student-a' },
    body: JSON.stringify({ id, revision, operation }),
  });
}

test('legacy step renumbering commits a revision before rejecting an old indexed mutation', async () => {
  const { api, rows } = harness();
  rows.set('student-a', {
    book: legacyBook(),
    clarification: null,
    revision: 7,
  });
  const response = await api.POST(
    mutationRequest('old-step', 7, {
      kind: 'revise-step',
      step: 3,
      expression: 'x=99',
    }),
  );
  expect(response.status).toBe(409);
  const { snapshot } = (await response.json()) as { snapshot: CloudSnapshot };
  expect(snapshot.revision).toBe(8);
  expect(currentProblem(snapshot.book).steps).toHaveLength(3);
  expect(currentProblem(rows.get('student-a')!.book).state.expression).toBe(
    'x = 3',
  );
  const read = (await (await api.GET(readRequest())).json()) as CloudSnapshot;
  expect(read.revision).toBe(8);
  expect(read.book).toEqual(rows.get('student-a')!.book);
});

test('legacy receipts never return renumbered steps at their original revision', async () => {
  const { api, rows, receipts } = harness();
  const book = legacyBook();
  rows.set('student-a', { book, clarification: null, revision: 7 });
  const operation = { kind: 'command', text: 'write x=3', interpret: false };
  receipts.set('student-a:old-save', {
    request: JSON.stringify({ revision: 6, operation }),
    result: {
      book,
      clarification: null,
      revision: 7,
      status: 'command',
      message: 'Saved',
    },
  });
  const response = await api.POST(mutationRequest('old-save', 6, operation));
  expect(response.status).toBe(409);
  const { snapshot } = (await response.json()) as { snapshot: CloudSnapshot };
  expect(snapshot.revision).toBe(8);
  expect(currentProblem(snapshot.book).steps).toHaveLength(3);
});

test('imported legacy rows are normalized in the import commit and its receipt', async () => {
  const { api } = harness();
  await api.GET(readRequest());
  const operation = { kind: 'import', notebook: JSON.stringify(legacyBook()) };
  const response = await api.POST(mutationRequest('import', 0, operation));
  expect(response.status).toBe(200);
  const saved = (await response.json()) as CloudSnapshot;
  expect(saved.book.assignments.at(-1)!.problems[0].steps).toHaveLength(3);
  expect(
    await (await api.POST(mutationRequest('import', 0, operation))).json(),
  ).toEqual(saved);
  expect(
    ((await (await api.GET(readRequest())).json()) as CloudSnapshot).revision,
  ).toBe(1);
});

test('GET retries a raced migration but bounds repeated commit failures', async () => {
  const { api, rows, store } = harness();
  rows.set('student-a', {
    book: legacyBook(),
    clarification: null,
    revision: 7,
  });
  const commit = store.commit.bind(store);
  let attempts = 0;
  store.commit = (...args) =>
    ++attempts === 1 ? Promise.resolve(false) : commit(...args);
  const response = await api.GET(readRequest());
  expect(response.status).toBe(200);
  expect(((await response.json()) as CloudSnapshot).revision).toBe(8);
  expect(attempts).toBe(2);
  rows.set('student-a', {
    book: legacyBook(),
    clarification: null,
    revision: 9,
  });
  attempts = 0;
  store.commit = async () => {
    attempts++;
    return false;
  };
  expect((await api.GET(readRequest())).status).toBe(503);
  expect(attempts).toBe(3);
});

test('concurrent history reads expose one persisted migration revision', async () => {
  const { api, rows } = harness();
  rows.set('student-a', {
    book: legacyBook(),
    clarification: null,
    revision: 7,
  });
  const responses = await Promise.all([
    api.GET(readRequest()),
    api.GET(readRequest()),
  ]);
  const snapshots = await Promise.all(
    responses.map(async (response) => (await response.json()) as CloudSnapshot),
  );
  expect(snapshots[0].book).toEqual(snapshots[1].book);
  expect(snapshots[0].revision).toBe(snapshots[1].revision);
  expect(snapshots[0].revision).toBe(8);
  expect(rows.get('student-a')!.revision).toBe(8);
});

test('an authenticated command retry saves exactly one step and cannot change another student problem', async () => {
  const { api, command } = harness();
  await api.GET(
    new Request('https://math.example/api/problems', {
      headers: { authorization: 'student-a' },
    }),
  );
  const first = await command('student-a', 'request-1', 0);
  expect(first.status).toBe(200);
  const retry = await command('student-a', 'request-1', 0);
  expect(await retry.json()).toEqual(await first.json());
  const own = await api.GET(
    new Request('https://math.example/api/problems', {
      headers: { authorization: 'student-a' },
    }),
  );
  expect(
    ((await own.json()) as CloudSnapshot).book.assignments[0].problems[0].steps,
  ).toHaveLength(1);
  const other = await api.GET(
    new Request('https://math.example/api/problems', {
      headers: { authorization: 'student-b' },
    }),
  );
  expect(
    ((await other.json()) as CloudSnapshot).book.assignments[0].problems[0]
      .steps,
  ).toHaveLength(0);
});

test('a program compiled from an old problem revision cannot overwrite newer work', async () => {
  const { command, api } = harness();
  expect((await command('student-a', 'new-work', 0)).status).toBe(200);
  const stale = await command(
    'student-a',
    'stale-program',
    0,
    'typescript\nproblem.save(math.equation("x=99"));',
  );
  expect(stale.status).toBe(409);
  const response = await api.GET(
    new Request('https://math.example/api/problems', {
      headers: { authorization: 'student-a' },
    }),
  );
  const snapshot = (await response.json()) as CloudSnapshot;
  expect(snapshot.book.assignments[0].problems[0].state.expression).toBe(
    '2 * x + 3 = 11',
  );
});

test('revision validation rejects malformed math without committing or trapping retry state', async () => {
  const { api, command } = harness();
  await command('student-a', 'start-revision', 0);
  const send = (id: string, expression: string, revision = 1) =>
    api.POST(
      new Request('https://math.example/api/problems', {
        method: 'POST',
        headers: { origin: 'https://math.example', authorization: 'student-a' },
        body: JSON.stringify({
          id,
          revision,
          operation: { kind: 'revise-step', step: 1, expression },
        }),
      }),
    );
  expect((await send('invalid-revision', 'new problem')).status).toBe(400);
  expect((await send('invalid-equation', 'x=(')).status).toBe(400);
  const first = await send('valid-revision', 'x=8');
  expect(first.status).toBe(200);
  const body = (await first.json()) as CloudSnapshot;
  expect(body.book.assignments[0].problems[0].state.expression).toBe('x = 8');
  expect(await (await send('valid-revision', 'x=8')).json()).toEqual(body);
  expect((await send('stale-revision', 'x=9')).status).toBe(409);
});

test('request timings expose read, interpretation and commit waits without changing the saved result', async () => {
  const h = harness();
  vi.useFakeTimers({ toFake: ['setTimeout', 'performance'] });
  const delay = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
  try {
    const api = createProblemLibraryApi({
      owner: async () => 'timing-owner',
      store: {
        load: async (owner) => {
          await delay(20);
          return h.store.load(owner);
        },
        receipt: async (owner, id) => {
          await delay(10);
          return h.store.receipt(owner, id);
        },
        commit: async (...args) => {
          await delay(30);
          return h.store.commit(...args);
        },
      },
      interpret: async () => {
        await delay(100);
        return { status: 'command', command: 'write x=4', message: '' };
      },
    });
    const pending = api.POST(
      new Request('https://math.example/api/problems', {
        method: 'POST',
        headers: { origin: 'https://math.example' },
        body: JSON.stringify({
          id: 'timed',
          revision: 0,
          operation: {
            kind: 'command',
            text: 'put x equal to four',
            interpret: true,
          },
        }),
      }),
    );
    await vi.runAllTimersAsync();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('Server-Timing')).toBe(
      'receipt;dur=10.0, load;dur=20.0, interpret;dur=100.0, execute;dur=100.0, commit;dur=30.0, total;dur=150.0',
    );
    const result = (await response.json()) as { book: CloudSnapshot['book'] };
    expect(currentProblem(result.book).state.expression).toBe('x = 4');
  } finally {
    vi.useRealTimers();
  }
});

test('a command reads its snapshot while the retry receipt is still pending', async () => {
  const h = harness();
  let release!: () => void;
  const receiptReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  let snapshotStarted = false;
  const api = createProblemLibraryApi({
    owner: async () => 'student-a',
    store: {
      ...h.store,
      receipt: async () => {
        await receiptReady;
        return null;
      },
      load: async (owner) => {
        snapshotStarted = true;
        return h.store.load(owner);
      },
    },
  });
  const pending = api.POST(
    mutationRequest('overlap', 0, {
      kind: 'command',
      text: 'write x=4',
      interpret: false,
    }),
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshotStarted).toBe(true);
  } finally {
    release();
  }
  const response = await pending;
  expect(response.status).toBe(200);
  const saved = (await response.json()) as CloudSnapshot;
  expect(currentProblem(saved.book).state.expression).toBe('x = 4');
});

test('a confirmed retry still returns its receipt when the speculative snapshot read fails', async () => {
  const h = harness();
  const first = await h.command('student-a', 'confirmed', 0);
  const expected = await first.json();
  h.store.load = async () => {
    throw new Error('Read unavailable');
  };
  const retried = await h.command('student-a', 'confirmed', 0);
  expect(retried.status).toBe(200);
  expect(await retried.json()).toEqual(expected);
});

test('a confirmed retry returns before a slow speculative snapshot finishes', async () => {
  const h = harness();
  const first = await h.command('student-a', 'fast-retry', 0);
  const expected = (await first.json()) as CloudSnapshot;
  let release!: () => void;
  h.store.load = () =>
    new Promise((resolve) => {
      release = () => resolve(expected);
    });
  let returned = false;
  const retried = h.command('student-a', 'fast-retry', 0).then((response) => {
    returned = true;
    return response;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(returned).toBe(true);
  } finally {
    release();
  }
  expect(await (await retried).json()).toEqual(expected);
});

test('problem deletion persists, retries once, and rejects a stale revision', async () => {
  const { api } = harness();
  const initial = (await (
    await api.GET(readRequest())
  ).json()) as CloudSnapshot;
  const operation = {
    kind: 'delete',
    assignmentId: initial.book.assignmentId,
    problemId: initial.book.problemId,
  };
  const deleted = await api.POST(
    mutationRequest('trash-test', initial.revision, operation),
  );
  expect(deleted.status).toBe(200);
  const result = (await deleted.json()) as CloudSnapshot;
  expect(
    result.book.assignments
      .flatMap((a) => a.problems)
      .some((p) => p.id === operation.problemId),
  ).toBe(false);
  expect(result.book.problemId).not.toBe(operation.problemId);
  const reloaded = (await (
    await api.GET(readRequest())
  ).json()) as CloudSnapshot;
  expect(reloaded.book).toEqual(result.book);
  const retry = await api.POST(
    mutationRequest('trash-test', initial.revision, operation),
  );
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({
    book: result.book,
    revision: result.revision,
  });
  const stale = await api.POST(
    mutationRequest('other-trash-test', initial.revision, {
      ...operation,
      problemId: result.book.problemId,
    }),
  );
  expect(stale.status).toBe(409);
  expect(
    ((await (await api.GET(readRequest())).json()) as CloudSnapshot).book,
  ).toEqual(result.book);
});

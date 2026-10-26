import { POST } from './live-token.ts';
import { afterEach, expect, test, vi } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  updateProblem,
} from '../../problems/index.ts';
import { runCommand } from '../../commands/index.ts';
const storage = vi.hoisted(() => ({ saved: undefined as unknown }));
vi.mock('cloudflare:workers', () => ({
  env: { OPENAI_API_KEY: 'test-key', CLOUD_TEST_MODE: 'true' },
}));
// The database boundary supplies saved state and an available connection lease.
vi.mock('../../problems/server.ts', () => ({
  problemLibraryStore: { load: async () => storage.saved },
  testProblemLibraryOwner: () => 'test:reconnect',
  database: () => async () => [{ lease_id: 'lease' }],
}));
afterEach(() => vi.unstubAllGlobals());

test('initial and reconnected sessions preserve delegation and instructions while refreshing saved context', async () => {
  const requests: {
    session: {
      model: string;
      instructions: string;
      delegation: unknown;
      store: boolean;
      input: { content: { text: string }[] }[];
    };
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return Response.json({
        transport: { sdp: 'v=0 answer' },
        session: { id: 'synthetic' },
      });
    }),
  );
  let book = createProblemLibrary();
  for (const revision of [0, 1]) {
    if (revision)
      book = updateProblem(book, (p) => ({
        ...p,
        state: runCommand(p.state, 'write x=4').state,
      }));
    storage.saved = { book, clarification: null, revision };
    const result = await POST(
      new Request('http://localhost/api/live-token', {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        body: JSON.stringify({ sdp: 'v=0 offer', revision: String(revision) }),
      }),
    );
    expect(result.status).toBe(200);
  }
  const initial = requests[0].session,
    reconnected = requests[1].session;
  expect(reconnected.delegation).toEqual({ type: 'client' });
  expect(reconnected.instructions).toBe(initial.instructions);
  expect(reconnected.model).toBe(initial.model);
  expect(reconnected.store).toBe(initial.store);
  const context = JSON.parse(reconnected.input[0].content[0].text);
  expect(context).toMatchObject({
    revision: 1,
    problem: { expression: 'x = 4' },
  });
  expect(currentProblem(book).state.expression).toBe('x = 4');
});

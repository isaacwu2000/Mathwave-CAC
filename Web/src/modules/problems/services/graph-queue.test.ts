import { expect, test } from 'vitest';
import { CloudProblemLibraryClient, createProblemLibrary } from '../index.ts';

test('a graph replaced while queued never reaches persistence and ordinary saves still finish', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operations: string[] = [];
  const snapshot = {
    book: createProblemLibrary(),
    clarification: null,
    revision: 0,
  };
  const client = new CloudProblemLibraryClient(async (_url, init) => {
    if (!init?.body) return Response.json(snapshot);
    const request = JSON.parse(init.body as string);
    operations.push(request.operation.kind);
    await gate;
    return Response.json({
      ...snapshot,
      status: 'command',
      message: 'Saved',
      revision: 1,
    });
  });
  await client.load();
  const first = client.apply({ kind: 'command', text: 'graph y=x' }, 'first');
  let replaced = false;
  const queued = client
    .apply(
      {
        kind: 'graph',
        text: 'graph y=x^2',
        commands: ['graph y=x^2'],
        baseRevision: 0,
      },
      'second',
      () => {
        if (replaced) throw new DOMException('Replaced', 'AbortError');
      },
    )
    .catch((e) => e.name);
  replaced = true;
  release();
  await first;
  expect(await queued).toBe('AbortError');
  expect(operations).toEqual(['command']);
  expect(client.snapshot?.revision).toBe(1);
});

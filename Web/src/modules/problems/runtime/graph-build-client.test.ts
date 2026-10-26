import { test, expect } from 'vitest';
import { GraphBuildClient } from './graph-build-client.ts';
import { GraphBuildError } from './graph-build-client.ts';

test('a replacement build aborts the old stream and cannot emit its late preview', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const client = new GraphBuildClient(async () => {
    if (++calls === 1) await gate;
    return new Response(
      '{"type":"preview","commands":["graph y=x"],"revision":2}\n{"type":"ready","commands":["graph y=x"],"revision":2}\n',
    );
  });
  const old: unknown[] = [],
    next: unknown[] = [];
  const first = client
    .start('graph old', 2, (e) => old.push(e))
    .catch((e) => e.name);
  const second = client.start('graph new', 2, (e) => next.push(e));
  release();
  expect(await first).toBe('AbortError');
  expect((await second).commands).toEqual(['graph y=x']);
  expect(old).toHaveLength(0);
  expect(next).toHaveLength(1);
});

test('clarification status reaches the caller so the next answer retains its request', async () => {
  const client = new GraphBuildClient(
    async () =>
      new Response(
        '{"type":"failed","status":"clarification","message":"What radius?"}\n',
      ),
  );
  try {
    await client.start('draw a circle', 0, () => {});
    throw new Error('Expected clarification');
  } catch (error) {
    expect(error).toBeInstanceOf(GraphBuildError);
    expect((error as GraphBuildError).status).toBe('clarification');
  }
});

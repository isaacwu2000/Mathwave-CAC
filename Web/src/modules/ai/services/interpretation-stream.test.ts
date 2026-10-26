import { expect, test } from 'vitest';
import { interpretationStream } from './interpretation-stream.ts';

test('delivers complete programs before the response finishes, never a partial string', async () => {
  let wire!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream({
      start(c) {
        wire = c;
      },
    }),
  );
  const emit = (event: object) =>
    wire.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
    );
  const previews: string[][] = [];
  const result = interpretationStream(
    response,
    new AbortController().signal,
    (programs) => previews.push(programs),
  );
  emit({
    type: 'response.output_text.delta',
    delta:
      '{"status":"command","programs":["problem.save(math.equation(\\"h^2=25\\"));", "problem.save(',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(previews).toEqual([['problem.save(math.equation("h^2=25"));']]);
  emit({
    type: 'response.output_text.delta',
    delta: 'math.equation(\\"h=5\\"));"],"message":"","presentation":null}',
  });
  emit({
    type: 'response.completed',
    response: { status: 'completed', output: [] },
  });
  wire.close();
  await result;
  expect(previews.at(-1)).toEqual([
    'problem.save(math.equation("h^2=25"));',
    'problem.save(math.equation("h=5"));',
  ]);
});

test.each(['explanation', 'correction', 'unsupported'])(
  'never applies a streamed %s proposal as a command preview',
  async (status) => {
    const events = [
      {
        type: 'response.output_text.delta',
        delta: JSON.stringify({
          status,
          programs: ['problem.save(math.equation("x=4"));'],
          message: '',
          presentation: null,
        }),
      },
      {
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      },
    ];
    const response = new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    );
    const previews: string[][] = [];
    await interpretationStream(
      response,
      new AbortController().signal,
      (programs) => previews.push(programs),
    );
    expect(previews).toEqual([]);
  },
);

test('an interrupted stream cannot return a completed result', async () => {
  const response = new Response(
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"status":"command","programs":["problem.save(math.equation(\\"x=4\\"));"' })}\n\n`,
  );
  await expect(
    interpretationStream(response, new AbortController().signal, () => {}),
  ).rejects.toThrow('incomplete');
});

test('cancels a pending provider read when the request is aborted', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const controller = new AbortController();
  const result = interpretationStream(response, controller.signal, () => {});
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled).toBe(true);
});

test.each([
  'response.failed',
  'response.incomplete',
  'response.refusal.delta',
  'error',
])('rejects the provider event %s', async (type) => {
  await expect(
    interpretationStream(
      new Response(`data: ${JSON.stringify({ type })}\n\n`),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow('did not complete');
});

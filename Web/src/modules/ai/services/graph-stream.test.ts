import { expect, test } from 'vitest';
import { graphStreamOutput } from './graph-stream.ts';
import { mathProgramCommand } from '../../commands/index.ts';

test('streamed commands survive split UTF-8 chunks and incomplete provider output is never accepted', async () => {
  const wire = [
    {
      type: 'response.output_text.delta',
      delta: '{"command":"graph y=x^2"}\n',
    },
    { type: 'response.completed', response: { status: 'completed' } },
  ]
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join('');
  const bytes = new TextEncoder().encode(wire);
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    }),
  );
  const output = [];
  for await (const item of graphStreamOutput(
    response,
    new AbortController().signal,
  ))
    output.push(item);
  expect(output).toEqual([{ command: 'graph y=x^2' }]);
  const unfinished = new Response(
    'data: ' +
      JSON.stringify({
        type: 'response.output_text.delta',
        delta: '{"command":"graph y=x"}\n',
      }) +
      '\n\n',
  );
  await expect(async () => {
    for await (const _item of graphStreamOutput(
      unfinished,
      new AbortController().signal,
    )) {
      /* consume */
    }
  }).rejects.toThrow('incomplete');
});

test('streamed TypeScript records become validated program commands', async () => {
  const program = 'problem.save(graph.plot("x^2"));';
  const wire = [
    {
      type: 'response.output_text.delta',
      delta: JSON.stringify({ program }) + '\n',
    },
    { type: 'response.completed', response: { status: 'completed' } },
  ]
    .map((event) => 'data: ' + JSON.stringify(event) + '\n\n')
    .join('');
  const output = [];
  for await (const item of graphStreamOutput(
    new Response(wire),
    new AbortController().signal,
  ))
    output.push(item);
  expect(output).toEqual([{ command: mathProgramCommand(program) }]);
});

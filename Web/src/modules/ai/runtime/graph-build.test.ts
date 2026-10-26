import { streamGraphCommands } from './graph-build.ts';
import { afterEach, expect, test, vi } from 'vitest';
import { createProblemLibrary } from '../../problems/index.ts';
import { graphInterpretationInstructions } from '../config/interpretation.ts';
vi.mock('cloudflare:workers', () => ({
  env: { OPENAI_API_KEY: 'synthetic-key' },
}));
afterEach(() => vi.unstubAllGlobals());

test('graph generation sends the generated graph-only API and preserves its output budget', async () => {
  let body: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      body = JSON.parse(init.body);
      const events = [
        {
          type: 'response.output_text.delta',
          delta:
            JSON.stringify({ program: 'problem.save(graph.plot("x^2"));' }) +
            '\n',
        },
        { type: 'response.completed', response: { status: 'completed' } },
      ];
      return new Response(
        events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''),
      );
    }),
  );
  const rows = [];
  for await (const row of streamGraphCommands(
    'graph x squared',
    { book: createProblemLibrary(), clarification: null },
    new AbortController().signal,
  ))
    rows.push(row);
  expect(rows).toEqual([
    { command: 'typescript\nproblem.save(graph.plot("x^2"));' },
  ]);
  expect(body).toMatchObject({
    model: 'gpt-6-luna',
    stream: true,
    max_output_tokens: 800,
  });
  expect(body.instructions).toContain(graphInterpretationInstructions);
  expect(body.instructions).not.toMatch(
    /statistics\.|history\.|audio\.|math\.solve/,
  );
});

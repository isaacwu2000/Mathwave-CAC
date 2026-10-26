import '../server.ts';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  updateProblem,
} from '../../problems/index.ts';
const config = vi.hoisted(() => ({
  OPENAI_API_KEY: 'test-key',
  CLOUD_TEST_MODE: 'false',
  OPENROUTER_API_KEY: 'router-test-key',
  MATH_AUDIO_COMMAND_PROFILE: 'luna-default',
}));
vi.mock('cloudflare:workers', () => ({ env: config }));
beforeEach(() => {
  vi.resetModules();
  config.OPENAI_API_KEY = 'test-key';
  config.CLOUD_TEST_MODE = 'false';
  config.MATH_AUDIO_COMMAND_PROFILE = 'luna-default';
});
afterEach(() => vi.unstubAllGlobals());

test('the provider emits TypeScript programs and previews the same executable language', async () => {
  const program = 'problem.save(math.equation("x=4"));';
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'command',
                  programs: ['inventTheorem();'],
                  presentation: null,
                  message: '',
                }),
              },
            ],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            type: 'function_call',
            name: 'preview_math',
            call_id: 'typed-preview',
            arguments: JSON.stringify({ program }),
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'command',
                  programs: [program],
                  message: '',
                  presentation: null,
                }),
              },
            ],
          },
        ],
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const book = createProblemLibrary();
  const result = await interpretProblemLibraryCommand('write x equals four', {
    book,
    clarification: null,
  });
  expect(result.command).toBe(`typescript\n${program}`);
  expect(currentProblem(book).steps).toHaveLength(0);
  const first = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(first.text.format.schema.required).toEqual([
    'status',
    'programs',
    'message',
    'presentation',
    'completion',
  ]);
  expect(
    JSON.parse(fetcher.mock.calls[1][1].body).tools.find(
      (t: { name: string }) => t.name === 'preview_math',
    ).parameters.required,
  ).toEqual(['program', 'programs']);
  const second = JSON.parse(fetcher.mock.calls[2][1].body);
  const observation = JSON.parse(
    second.input.find(
      (i: { type: string }) => i.type === 'function_call_output',
    ).output,
  );
  expect(observation).toMatchObject({
    applied: false,
    workspace: { expression: 'x = 4' },
  });
});
const request = (
  path: string,
  body: object = {},
  origin = 'http://localhost',
) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(body),
  });
test('requests without an account or guest identity never reach the provider', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { interpretCommand, connectVoice, voiceSetup } =
    await import('../server.ts');
  expect(
    (await interpretCommand(request('/api/interpret', { text: 'solve' })))
      .status,
  ).toBe(401);
  expect(
    (await connectVoice(request('/api/live-token', { sdp: 'v=0' }))).status,
  ).toBe(401);
  expect(
    (await voiceSetup(new Request('https://math-audio.example/api/live-token')))
      .status,
  ).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
test('cross-origin requests are rejected before authentication or provider access', async () => {
  const { interpretCommand, connectVoice } = await import('../server.ts');
  expect(
    (
      await interpretCommand(
        request('/api/interpret', {}, 'https://elsewhere.example'),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await connectVoice(
        request('/api/live-token', {}, 'https://elsewhere.example'),
      )
    ).status,
  ).toBe(403);
});
test('the command interpreter validates model output against saved mathematical state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'command',
                  programs: ['problem.save(math.equation("x=4"));'],
                  presentation: null,
                  message: '',
                }),
              },
            ],
          },
        ],
      }),
    ),
  );
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const book = createProblemLibrary();
  expect(
    await interpretProblemLibraryCommand('write x=4', {
      book,
      clarification: null,
    }),
  ).toMatchObject({
    status: 'command',
    command: 'typescript\nproblem.save(math.equation("x=4"));',
  });
  expect(currentProblem(book).steps).toHaveLength(0);
});
test('unsupported model commands are rejected', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'command',
                  programs: ['inventTheorem();'],
                  presentation: null,
                  message: '',
                }),
              },
            ],
          },
        ],
      }),
    ),
  );
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  await expect(
    interpretProblemLibraryCommand('solve', {
      book: createProblemLibrary(),
      clarification: null,
    }),
  ).rejects.toThrow();
});

test('stateless interpretation evaluations preserve supplied history and conversation', async () => {
  config.CLOUD_TEST_MODE = 'true';
  const history = {
    steps: [{ number: 1, command: 'write x=4' }],
    total: 1,
    undoCount: 1,
    redoCount: 0,
  };
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                status: 'command',
                programs: ['history.undo(1);'],
                presentation: null,
                message: '',
              }),
            },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { interpretCommand } = await import('../server.ts');
  const result = await interpretCommand(
    request('/api/interpret', {
      text: 'undo',
      state: currentProblem(createProblemLibrary()).state,
      history,
      conversation: [],
    }),
  );
  expect(result.status).toBe(200);
  expect(result.headers.get('Server-Timing')).toMatch(
    /model_1;dur=\d+(?:\.\d+)?/,
  );
  expect(await result.json()).toMatchObject({
    status: 'command',
    command: 'undo 1',
  });
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.parse(sent.input).history).toEqual(history);
});

test('server interpretation previews mathematics read-only before returning an explanation', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            type: 'function_call',
            name: 'preview_math',
            call_id: 'preview-1',
            arguments: JSON.stringify({ commands: ['write x=4'] }),
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'explanation',
                  programs: [],
                  presentation: null,
                  message: 'The preview gives x equals four.',
                }),
              },
            ],
          },
        ],
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const book = createProblemLibrary();
  const result = await interpretProblemLibraryCommand('explain the result', {
    book,
    clarification: null,
  });
  expect(result.status).toBe('explanation');
  expect(currentProblem(book).steps).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const second = JSON.parse(fetcher.mock.calls[1][1].body);
  const observed = second.input.find(
    (item: { type?: string }) => item.type === 'function_call_output',
  );
  expect(JSON.parse(observed.output)).toMatchObject({
    applied: false,
    workspace: { expression: 'x = 4' },
  });
});

test('voice backend requests retain the same preview tools after saved state changes', async () => {
  const fetcher = vi.fn().mockImplementation(async () =>
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                status: 'command',
                programs: ['problem.save(math.equation("x=4"));'],
                message: '',
                presentation: null,
              }),
            },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const book = createProblemLibrary();
  await interpretProblemLibraryCommand('write x equals four', {
    book,
    clarification: null,
  });
  await interpretProblemLibraryCommand('write x equals four', {
    book: updateProblem(book, (p) => ({
      ...p,
      state: { ...p.state, expression: '2 * x + 3 = 11' },
    })),
    clarification: null,
  });
  const initial = JSON.parse(fetcher.mock.calls[0][1].body);
  const reconnected = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(reconnected.tools).toEqual(initial.tools);
  expect(reconnected.tools).toEqual([]);
  expect(reconnected.model).toBe(initial.model);
  expect(reconnected.text.format).toEqual(initial.text.format);
});

test('clear proposals skip previews, and invalid proposals expose repair progress without changing saved work', async () => {
  const answer = (command: string) => ({
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              status: 'command',
              programs: [
                command === 'write x=4'
                  ? 'problem.save(math.equation("x=4"));'
                  : 'inventTheorem();',
              ],
              message: '',
              presentation: null,
            }),
          },
        ],
      },
    ],
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(answer('invent a theorem')))
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            type: 'function_call',
            name: 'preview_math',
            call_id: 'repair',
            arguments: JSON.stringify({
              program: 'problem.save(math.equation("x=4"));',
            }),
          },
        ],
      }),
    )
    .mockResolvedValueOnce(Response.json(answer('write x=4')));
  vi.stubGlobal('fetch', fetcher);
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const book = createProblemLibrary();
  const progress: unknown[] = [];
  const result = await interpretProblemLibraryCommand(
    'put x equal to four',
    { book, clarification: null },
    undefined,
    undefined,
    (value) => progress.push(value),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body).tools).toEqual([]);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).tools).toHaveLength(2);
  expect(progress).toEqual([
    { phase: 'fixing', workspace: currentProblem(book).state, steps: [] },
    {
      phase: 'checking',
      workspace: expect.objectContaining({ expression: 'x = 4' }),
    },
  ]);
  expect(result.command).toBe(
    'typescript\nproblem.save(math.equation("x=4"));',
  );
  expect(currentProblem(book).steps).toHaveLength(0);
});

test('Haiku uses the configured effort and the same validated output contract through OpenRouter', async () => {
  config.MATH_AUDIO_COMMAND_PROFILE = 'haiku-low';
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                status: 'command',
                programs: ['problem.save(math.equation("x=4"));'],
                message: '',
                presentation: null,
              }),
            },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const result = await interpretProblemLibraryCommand('put x equal to four', {
    book: createProblemLibrary(),
    clarification: null,
  });
  expect(fetcher.mock.calls[0][0]).toBe(
    'https://openrouter.ai/api/v1/responses',
  );
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.model).toBe('anthropic/claude-haiku-5.5');
  expect(body.reasoning).toEqual({ effort: 'low', enabled: true });
  expect(body.text.format.strict).toBe(true);
  expect(result.command).toBe(
    'typescript\nproblem.save(math.equation("x=4"));',
  );
});

test('streams validated equation history before final completion without saving the preview', async () => {
  let wire!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            wire = c;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const { interpretProblemLibraryCommand } = await import('../server.ts');
  const book = createProblemLibrary();
  const progress: import('../../problems/index.ts').InterpretationProgress[] =
    [];
  const programs = [
    'problem.save(math.equation("h^2=25"));',
    'problem.save(math.equation("h=5"));',
  ];
  const task = interpretProblemLibraryCommand(
    'write h squared equals 25 then write h equals 5',
    { book, clarification: null },
    undefined,
    undefined,
    (value) => progress.push(value),
  );
  await vi.waitFor(() => expect(wire).toBeDefined());
  const emit = (event: object) =>
    wire.enqueue(
      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
    );
  const prefix = `{"status":"command","programs":[${JSON.stringify(programs[0])}`;
  emit({ type: 'response.output_text.delta', delta: prefix });
  await vi.waitFor(() => expect(progress).toHaveLength(1));
  expect(progress[0].steps?.map((s) => s.state.expression)).toEqual([
    'h^2 = 25',
  ]);
  expect(currentProblem(book).steps).toHaveLength(0);
  const answer = JSON.stringify({
    status: 'command',
    programs,
    message: '',
    presentation: null,
  });
  emit({
    type: 'response.output_text.delta',
    delta: answer.slice(prefix.length),
  });
  await vi.waitFor(() => expect(progress).toHaveLength(2));
  expect(progress[1].steps?.map((s) => s.state.expression)).toEqual([
    'h^2 = 25',
    'h = 5',
  ]);
  emit({
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: answer }] }],
    },
  });
  wire.close();
  expect((await task).commands).toHaveLength(2);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).stream).toBe(
    true,
  );
  expect(currentProblem(book).steps).toHaveLength(0);
});

import { afterEach, expect, test, vi } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
} from '../../Web/src/modules/problems/index.ts';
import { interpretWithPrompt } from './prompt-provider.ts';

afterEach(() => vi.unstubAllGlobals());
const provider = {
  model: 'synthetic',
  url: 'https://synthetic.invalid/responses',
  key: 'synthetic-key',
};
const result = (answer: object) =>
  Response.json({
    output: [
      { content: [{ type: 'output_text', text: JSON.stringify(answer) }] },
    ],
  });
test('alternate prompts use the same validation and repair invalid programs without saving', async () => {
  const saved = { book: createProblemLibrary(), clarification: null };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      result({
        status: 'command',
        programs: ['inventMath();'],
        presentation: null,
        message: '',
      }),
    )
    .mockResolvedValueOnce(
      result({
        status: 'command',
        programs: ['problem.save(math.equation("x=4"));'],
        presentation: null,
        message: '',
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const output = await interpretWithPrompt(
    'write x equals four',
    saved,
    'Candidate prompt',
    provider,
  );
  expect(output.interpretation?.status).toBe('command');
  expect(output.rounds).toHaveLength(2);
  expect(output.repairs).toBe(1);
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  const { input: _input, ...safeRequest } = sent;
  expect(output.rounds[0].request).toEqual(safeRequest);
  expect(JSON.stringify(output.rounds)).not.toContain('synthetic-key');
  expect(currentProblem(saved.book).steps).toHaveLength(0);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).instructions).toContain(
    'Candidate prompt',
  );
});
test('clarification answers carry their original request to the model', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    result({
      status: 'clarification',
      programs: [],
      presentation: null,
      message: 'Which side?',
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  await interpretWithPrompt(
    'three',
    {
      book: createProblemLibrary(),
      clarification: {
        request: 'subtract a number',
        question: 'Which number?',
      },
    },
    'Candidate prompt',
    provider,
  );
  expect(
    JSON.parse(JSON.parse(fetcher.mock.calls[0][1].body).input).clarification
      .request,
  ).toBe('subtract a number');
});

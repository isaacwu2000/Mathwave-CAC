import { expect, test } from 'vitest';
import { runLocalAgent } from '../../Native/Engine/agent.ts';
import {
  createProblemLibrary,
  currentProblem,
} from '../../Web/src/modules/problems/index.ts';

const answer = (programs: string[], status = 'command', message = '') => ({
  answer: { status, programs, message, presentation: null },
});

test('local model actions use the web DSL and preserve ordered saved steps', async () => {
  const initial = await runLocalAgent(
    createProblemLibrary(),
    'write 2*x+3=11',
    async () => {
      throw new Error('Explicit input needs no inference');
    },
  );
  const changed = await runLocalAgent(
    initial.book,
    'Take away three, then simplify the result.',
    async () =>
      answer([
        'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
        'problem.save(math.simplify(problem.currentEquation()));',
      ]),
  );
  expect(changed.status).toBe('command');
  expect(currentProblem(changed.book).state.expression).toBe('2 * x = 8');
  expect(currentProblem(changed.book).steps).toHaveLength(3);
  expect(currentProblem(initial.book).state.expression).toBe('2 * x + 3 = 11');
});

test('previews return calculated observations without changing work or saving a query', async () => {
  const initial = await runLocalAgent(
    createProblemLibrary(),
    'data 2,4,9',
    async () => {
      throw new Error('No inference');
    },
  );
  const response = await runLocalAgent(
    initial.book,
    'Explain what the average of this list is without changing it.',
    async (request) => {
      if (request.input.length === 1)
        return {
          calls: [
            {
              id: 'mean',
              name: 'preview_math',
              arguments: JSON.stringify({
                program: 'statistics.mean(statistics.current());',
                programs: [],
              }),
            },
          ],
        };
      const observation = request.input.at(-1) as { output: string };
      expect(JSON.parse(observation.output).messages.join(' ')).toContain('5');
      return answer([], 'explanation', 'The mean is 5: 15 divided by 3.');
    },
  );
  expect(response.message).toContain('5');
  expect(currentProblem(response.book).steps).toHaveLength(1);
  expect(currentProblem(response.book).state.data).toEqual([2, 4, 9]);
});

test('unaccepted suggestions remain read-only and the follow-up applies the retained DSL', async () => {
  const initial = await runLocalAgent(
    createProblemLibrary(),
    'write x+3=8',
    async () => {
      throw new Error('No inference');
    },
  );
  const proposed = await runLocalAgent(
    initial.book,
    'What could I try next? Suggest an action without applying it.',
    async () =>
      answer(
        ['problem.save(math.subtractBothSides(problem.currentEquation(),3));'],
        'explanation',
        'Try subtracting three from both sides.',
      ),
  );
  expect(currentProblem(proposed.book).state.expression).toBe('x + 3 = 8');
  const accepted = await runLocalAgent(proposed.book, 'yes', async () => {
    throw new Error('Acceptance should use retained work');
  });
  expect(accepted.status).toBe('command');
  expect(currentProblem(accepted.book).steps).toHaveLength(2);
});

test('bad final programs are rejected atomically, keep drafts and stop repair attempts', async () => {
  const initial = await runLocalAgent(
    createProblemLibrary(),
    'write x+3=8',
    async () => {
      throw new Error('No inference');
    },
  );
  initial.book.draft = 'unfinished';
  const response = await runLocalAgent(
    initial.book,
    'Carry out a custom change for me.',
    async () =>
      answer([
        'problem.save(math.equation("x=9"));',
        'problem.save(math.divideBothSides(problem.currentEquation(),0));',
      ]),
  );
  expect(response.status).toBe('unsupported');
  expect(response.book).toEqual(initial.book);
});

test('repair sees the validation error and latest workspace before returning a checked action', async () => {
  const initial = await runLocalAgent(
    createProblemLibrary(),
    'write x+3=8',
    async () => {
      throw new Error('No inference');
    },
  );
  const result = await runLocalAgent(
    initial.book,
    'Please perform the adjustment we discussed.',
    async (request) => {
      if (request.input.length === 1) {
        const context = JSON.parse(
          (request.input[0] as { content: string }).content,
        );
        expect(context.workspace.expression).toBe('x + 3 = 8');
        expect(request.schema.required).toEqual([
          'status',
          'programs',
          'message',
          'presentation',
          'completion',
        ]);
        return answer([
          'problem.save(math.divideBothSides(problem.currentEquation(),0));',
        ]);
      }
      expect(request.input.at(-1)).toHaveProperty('content');
      return answer([
        'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
      ]);
    },
  );
  expect(result.status).toBe('command');
  expect(currentProblem(result.book).steps).toHaveLength(2);
});

test('corrections replace the preceding operation against its original state', async () => {
  const first = await runLocalAgent(
    createProblemLibrary(),
    'write x+3=8',
    async () => {
      throw new Error('No inference');
    },
  );
  const wrong = await runLocalAgent(
    first.book,
    'Take away two on each side.',
    async () =>
      answer([
        'problem.save(math.subtractBothSides(problem.currentEquation(),2));',
      ]),
  );
  const corrected = await runLocalAgent(
    wrong.book,
    'Actually I meant subtract three instead.',
    async () =>
      answer(
        ['problem.save(math.subtractBothSides(problem.currentEquation(),3));'],
        'correction',
      ),
  );
  expect(corrected.status).toBe('correction');
  expect(currentProblem(corrected.book).state.expression).toBe(
    'x + 3 - 3 = 8 - 3',
  );
  expect(currentProblem(corrected.book).steps).toHaveLength(2);
});

test('a clarification reply can complete a correction without repeating correction words', async () => {
  const first = await runLocalAgent(
    createProblemLibrary(),
    'write x+3=8',
    async () => {
      throw new Error('No inference');
    },
  );
  const wrong = await runLocalAgent(
    first.book,
    'Take away two on each side.',
    async () =>
      answer([
        'problem.save(math.subtractBothSides(problem.currentEquation(),2));',
      ]),
  );
  const corrected = await runLocalAgent(
    wrong.book,
    'three',
    async () =>
      answer(
        ['problem.save(math.subtractBothSides(problem.currentEquation(),3));'],
        'correction',
      ),
    {
      request: 'Actually subtract a different number instead.',
      question: 'Which number?',
    },
  );
  expect(corrected.status).toBe('correction');
  expect(currentProblem(corrected.book).state.expression).toBe(
    'x + 3 - 3 = 8 - 3',
  );
});

test('local inference receives the exact shared web prompt and response schema', async () => {
  const { commandInstructionsFor, interpretationSchema } =
    await import('../../Web/src/modules/ai/index.ts');
  const initial = await runLocalAgent(
    createProblemLibrary(),
    'write 2*x+3=11',
    async () => {
      throw new Error('Explicit entry must remain deterministic');
    },
  );
  const text = 'Take away three, then simplify the result.';
  let captured:
    | import('../../Native/Engine/agent.ts').LocalModelRequest
    | undefined;
  await runLocalAgent(initial.book, text, async (request) => {
    captured = request;
    return answer([
      'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
      'problem.save(math.simplify(problem.currentEquation()));',
    ]);
  });
  expect(captured?.instructions).toBe(
    commandInstructionsFor(text, currentProblem(initial.book).state),
  );
  expect(captured?.schema).toBe(interpretationSchema);
});

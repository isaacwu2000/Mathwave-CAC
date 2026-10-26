import { expect, test } from 'vitest';
import { applyCloudOperation } from './cloud-problem-library.ts';
import { createProblemLibrary } from './problem-library.ts';

test('a correct final linear step produces verified completion, not an ordinary saved operation', async () => {
  const initial = { book: createProblemLibrary(), clarification: null };
  const entered = await applyCloudOperation(initial, {
    kind: 'command',
    text: 'write 2*x+3=11',
  });
  expect(entered).not.toHaveProperty('completion');
  const intermediate = await applyCloudOperation(entered, {
    kind: 'command',
    text: 'subtract 3 from both sides',
  });
  expect(intermediate).not.toHaveProperty('completion');
  const finished = await applyCloudOperation(intermediate, {
    kind: 'command',
    text: 'write x=4',
  });
  expect(finished).toHaveProperty('completion', {
    problemId: initial.book.problemId,
    equation: '2 * x + 3 = 11',
    answer: 'x = 4',
  });
});

test.each([
  ['2*x+3=11', 'x=5'],
  ['2*x+3=11', '2*x=8'],
  ['x^2=4', 'x=2'],
  ['x/x=1', 'x=1'],
  ['(x-1)/(x-1)=1', 'x=1'],
  ['x-x=0', 'x=7'],
  ['x-x=1', 'x=0'],
  ['sin(x)=0', 'x=0'],
  ['2*y=8', 'y=4'],
  ['3*x=1', 'x=0.333333333333'],
  ['4.0000000000000001*x=4', 'x=1'],
])(
  'never celebrates incorrect, incomplete, unsupported, or rounded work: %s → %s',
  async (equation, answer) => {
    const entered = await applyCloudOperation(
      { book: createProblemLibrary(), clarification: null },
      { kind: 'command', text: `write ${equation}` },
    );
    const result = await applyCloudOperation(entered, {
      kind: 'command',
      text: `write ${answer}`,
    });
    expect(result).not.toHaveProperty('completion');
  },
);

test('exact fractional solutions and explicit deterministic solves can complete the objective', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 3*x=1' },
  );
  const result = await applyCloudOperation(entered, {
    kind: 'command',
    text: 'write x=1/3',
  });
  expect(result.completion?.answer).toBe('x = 1/3');
  const solve = await applyCloudOperation(entered, {
    kind: 'command',
    text: 'solve',
  });
  expect(solve.completion?.answer).toBe('x = 1/3');
  const read = await applyCloudOperation(result, {
    kind: 'command',
    text: 'read',
  });
  expect(read).not.toHaveProperty('completion');
  const undo = await applyCloudOperation(result, {
    kind: 'command',
    text: 'undo',
  });
  expect(undo).not.toHaveProperty('completion');
});

test('history replay never issues a fresh completion event, even without a browser receipt', async () => {
  let result = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3=11' },
  );
  result = await applyCloudOperation(result, {
    kind: 'command',
    text: 'write x=4',
  });
  expect(result.completion?.answer).toBe('x = 4');
  result = await applyCloudOperation(result, { kind: 'command', text: 'undo' });
  result = await applyCloudOperation(result, { kind: 'command', text: 'redo' });
  expect(result).not.toHaveProperty('completion');
});

test('spoken decimal coefficients cannot round into a false exact verification', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    {
      kind: 'command',
      text: 'write four point zero zero zero zero zero zero zero zero zero zero zero zero zero zero zero one*x=4',
    },
  );
  const result = await applyCloudOperation(entered, {
    kind: 'command',
    text: 'write x=1',
  });
  expect(result).not.toHaveProperty('completion');
});

test.each([
  ['x^2+3*x+2', ['x=-2', 'x=-1'], 'x = -2 or x = -1'],
  ['h^2=3^2+4^2', ['h=5'], 'h = 5'],
])(
  'celebrates agent-confirmed solutions for %s after recording every equation',
  async (problem, answers, answer) => {
    const entered = await applyCloudOperation(
      { book: createProblemLibrary(), clarification: null },
      { kind: 'command', text: `write ${problem}` },
    );
    const result = await applyCloudOperation(
      entered,
      {
        kind: 'command',
        text: 'The solution should be ' + answers.join(' and '),
        interpret: true,
      },
      async () => ({
        status: 'command',
        command: '',
        commands: answers.map((expression) => `write ${expression}`),
        message: '',
        completion: { answer },
      }),
    );
    const { currentProblem } = await import('./problem-library.ts');
    expect(
      currentProblem(result.book)
        .steps.slice(-answers.length)
        .map((step) => step.state.expression),
    ).toEqual(answers.map((expression) => expression.replace('=', ' = ')));
    expect(result.completion?.answer).toBe(answer);
  },
);

test('agent-confirmed statistics answers can celebrate without a new equation', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'data 2,4,8,10' },
  );
  const result = await applyCloudOperation(
    entered,
    { kind: 'command', text: 'Find the median', interpret: true },
    async () => ({
      status: 'command',
      command: 'median',
      message: '',
      completion: { answer: '6' },
    }),
  );
  expect(result.completion?.answer).toBe('6');
});

test('unapplied suggestions cannot celebrate even when a model supplies a completion verdict', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write h^2=25' },
  );
  const result = await applyCloudOperation(
    entered,
    {
      kind: 'command',
      text: 'Explain without changing my work',
      interpret: true,
    },
    async () => ({
      status: 'explanation',
      command: '',
      commands: ['write h=5'],
      message: 'You could take the square root.',
      completion: { answer: 'h=5' },
    }),
  );
  expect(result).not.toHaveProperty('completion');
});

test('a failed program cannot celebrate even if the agent judged its proposed answer correct', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write h^2=25' },
  );
  const result = await applyCloudOperation(
    entered,
    { kind: 'command', text: 'Find h', interpret: true },
    async () => ({
      status: 'command',
      command: 'typescript\nproblem.save(math.equation("h="));',
      message: '',
      completion: { answer: 'h=5' },
    }),
  );
  expect(result).not.toHaveProperty('completion');
  expect(result.book).toEqual(entered.book);
});

test('an explicit incomplete agent verdict overrides direct linear verification', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x=8' },
  );
  const result = await applyCloudOperation(
    entered,
    { kind: 'command', text: 'write x=4', interpret: true },
    async () => ({
      status: 'command',
      command: 'write x=4',
      message: 'The second part still needs work.',
      completion: null,
    }),
  );
  expect(result).not.toHaveProperty('completion');
});

test('a simplification that finishes h is assessed by the agent', async () => {
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write h=sqrt(25)' },
  );
  let assessed = false;
  const result = await applyCloudOperation(
    entered,
    { kind: 'command', text: 'simplify', interpret: true },
    async () => {
      assessed = true;
      return {
        status: 'command',
        command: 'simplify',
        message: '',
        completion: { answer: 'h = 5' },
      };
    },
  );
  expect(assessed).toBe(true);
  expect(result.completion?.answer).toBe('h = 5');
});

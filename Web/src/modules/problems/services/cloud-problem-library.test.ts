import { expect, test } from 'vitest';
import { createProblemLibrary, currentProblem } from '../index.ts';
import { applyCloudOperation } from './cloud-problem-library.ts';

test('a cloud command saves a deterministic equation step without trusting a client workspace', async () => {
  const result = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3=11', interpret: false },
  );
  expect(currentProblem(result.book).state.expression).toBe('2 * x + 3 = 11');
  expect(currentProblem(result.book).steps).toHaveLength(1);
  expect(result.status).toBe('command');
});

test('cloud explanations retain suggestions without changing math and confirmation applies once', async () => {
  const initial = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3=11' },
  );
  const explained = await applyCloudOperation(
    initial,
    { kind: 'command', text: 'explain the next step', interpret: true },
    async () => ({
      status: 'explanation',
      command: '',
      message: 'Subtract three from both sides.',
      commands: ['subtract 3 from both sides'],
    }),
  );
  expect(currentProblem(explained.book).steps).toHaveLength(1);
  expect(currentProblem(explained.book).conversation?.at(-1)?.status).toBe(
    'explanation',
  );
  const confirmed = await applyCloudOperation(explained, {
    kind: 'command',
    text: 'do that',
  });
  expect(currentProblem(confirmed.book).state.expression).toBe(
    '2 * x + 3 - 3 = 11 - 3',
  );
  expect(currentProblem(confirmed.book).steps).toHaveLength(2);
});

test('cloud corrections atomically replace the previous turn and retain undo', async () => {
  const initial = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3=11' },
  );
  const changed = await applyCloudOperation(initial, {
    kind: 'command',
    text: 'subtract 2 from both sides',
  });
  const corrected = await applyCloudOperation(
    changed,
    { kind: 'command', text: 'I meant subtract three', interpret: true },
    async () => ({
      status: 'correction',
      command: '',
      message: '',
      commands: ['subtract 3 from both sides'],
    }),
  );
  expect(currentProblem(corrected.book).state.expression).toBe(
    '2 * x + 3 - 3 = 11 - 3',
  );
  expect(currentProblem(corrected.book).steps).toHaveLength(2);
  const restored = await applyCloudOperation(corrected, {
    kind: 'command',
    text: 'undo',
  });
  expect(currentProblem(restored.book).state.expression).toBe(
    '2 * x + 3 - 2 = 11 - 2',
  );
});

test('interactive explanations persist and controls change through cloud operations without homework steps', async () => {
  const content = {
    title: 'Coefficient',
    description: 'Change a.',
    controls: [
      { name: 'a', label: 'Coefficient', min: -3, max: 3, step: 1, value: 1 },
    ],
    plots: ['y=a*x'],
    readouts: [{ label: 'Twice a', expression: '2*a' }],
    xRange: { min: -5, max: 5 },
    yRange: { min: -5, max: 5 },
  };
  const initial = { book: createProblemLibrary(), clarification: null };
  const shown = await applyCloudOperation(
    initial,
    { kind: 'command', text: 'explain a coefficient', interpret: true },
    async () => ({
      status: 'explanation',
      command: '',
      message: 'Move the control.',
      presentation: { action: 'show', content },
    }),
  );
  expect(currentProblem(shown.book).exploration?.controls[0].value).toBe(1);
  const changed = await applyCloudOperation(shown, {
    kind: 'exploration',
    name: 'a',
    value: 2,
  });
  expect(currentProblem(changed.book).exploration?.controls[0].value).toBe(2);
  expect(currentProblem(changed.book).steps).toHaveLength(0);
  expect(currentProblem(changed.book).state).toEqual(
    currentProblem(initial.book).state,
  );
  const hidden = await applyCloudOperation(changed, {
    kind: 'dismiss-exploration',
  });
  expect(currentProblem(hidden.book).exploration).toBeUndefined();
});

test('graph viewport feedback never creates repeated equation steps', async () => {
  let saved = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'graph x^3+5*x^2+6', interpret: false },
  );
  const equation = currentProblem(saved.book).state.expression;
  for (let i = 0; i < 20; i++) {
    saved = await applyCloudOperation(saved, {
      kind: 'command',
      text: `view x ${-10 - i / 1000} to ${10 + i / 1000} y -10 to 10`,
      interpret: false,
    });
  }
  expect(currentProblem(saved.book).steps).toHaveLength(1);
  expect(currentProblem(saved.book).state.expression).toBe(equation);
  expect(currentProblem(saved.book).state.graphRange).toEqual({
    min: -10.019,
    max: 10.019,
  });
});

test('routine simplify and readback save or inspect work without a model request', async () => {
  let saved = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3-3=11-3' },
  );
  let calls = 0;
  const interpret = async () => {
    calls++;
    throw new Error('Should not need a model.');
  };
  saved = await applyCloudOperation(
    saved,
    { kind: 'command', text: 'simplify', interpret: true },
    interpret,
  );
  expect(currentProblem(saved.book).state.expression).toBe('2 * x = 8');
  const steps = currentProblem(saved.book).steps.length;
  const read = await applyCloudOperation(
    saved,
    { kind: 'command', text: 'read the right side', interpret: true },
    interpret,
  );
  expect(read.message).toContain('8');
  expect(currentProblem(read.book).steps).toHaveLength(steps);
  expect(calls).toBe(0);
});

test('clear equation shorthand executes without calling the AI interpreter', async () => {
  let saved = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3=11' },
  );
  let calls = 0;
  const interpret = async () => {
    calls++;
    throw new Error('No model needed');
  };
  saved = await applyCloudOperation(
    saved,
    { kind: 'command', text: 'Please subtract three.', interpret: true },
    interpret,
  );
  expect(saved.status).toBe('command');
  expect(saved.clarification).toBeNull();
  expect(currentProblem(saved.book).state.expression).toBe(
    '2 * x + 3 - 3 = 11 - 3',
  );
  expect(calls).toBe(0);
});

test('a unique graph term edit saves the changed curve without an interpreter round trip', async () => {
  const before = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    {
      kind: 'command',
      text: 'I’ll graph y equals x squared plus five x plus two.',
      interpret: true,
    },
    async () => {
      throw new Error('An explicit function must not call the interpreter');
    },
  );
  expect(before.aiUnavailable).toBeFalsy();
  const after = await applyCloudOperation(
    before,
    { kind: 'command', text: 'Now change five x to three x.', interpret: true },
    async () => {
      throw new Error('A clear term edit must not call the interpreter');
    },
  );
  expect(after.status).toBe('command');
  expect(after.aiUnavailable).toBeFalsy();
  const problem = currentProblem(after.book);
  expect(problem.state.expression).toBe('y = x^2 + 3 * x + 2');
  expect(problem.state.graph).toBe(true);
  expect(problem.steps).toHaveLength(2);
  expect(currentProblem(before.book).state.expression).toBe(
    'y = x^2 + 5 * x + 2',
  );
});

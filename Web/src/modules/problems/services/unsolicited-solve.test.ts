import { expect, test } from 'vitest';
import { applyCloudOperation } from './cloud-problem-library.ts';
import { createProblemLibrary, currentProblem } from './problem-library.ts';

test('entering simple arithmetic records the expression without calculating until asked', async () => {
  const interpret = async () => ({
    status: 'command' as const,
    command: '',
    commands: ['write 2+3', 'calculate'],
    message: '',
  });
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'two plus three', interpret: true },
    interpret,
  );
  expect(currentProblem(entered.book).state.expression).toBe('2 + 3');
  expect(entered.message).not.toContain('Result:');
  const requested = await applyCloudOperation(entered, {
    kind: 'command',
    text: 'calculate',
  });
  expect(requested.message).toContain('Result: 5');
});

test('introducing an algebra problem leaves the next step to the student until an explicit solve', async () => {
  const interpret = async () => ({
    status: 'command' as const,
    command: '',
    commands: ['write x+5=7', 'solve'],
    message: '',
  });
  const entered = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    {
      kind: 'command',
      text: "Okay, let's solve the problem x plus five equals seven",
      interpret: true,
    },
    interpret,
  );
  expect(currentProblem(entered.book).state.expression).toBe('x + 5 = 7');
  expect(currentProblem(entered.book).steps).toHaveLength(1);
  expect(entered.message).not.toContain('x = 2');
  const requested = await applyCloudOperation(entered, {
    kind: 'command',
    text: 'solve',
  });
  expect(requested.message).toContain('x = 2');
});

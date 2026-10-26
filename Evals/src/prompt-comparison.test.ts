import { expect, test } from 'vitest';
import { assessPromptAnswer, promptCases } from './prompt-comparison.ts';

test('prompt comparison rejects a shortcut that skips the requested intermediate step', async () => {
  const example = promptCases.find((item) => item.id === 'two-steps')!;
  expect(
    (
      await assessPromptAnswer(example, {
        status: 'command',
        command: '',
        program: 'problem.save(math.equation("x=4"));',
        message: '',
      })
    ).passed,
  ).toBe(false);
});

test('prompt comparison executes a named revision and checks preserved recovery', async () => {
  const example = promptCases.find((item) => item.id === 'revise-step')!;
  expect(
    (
      await assessPromptAnswer(example, {
        status: 'command',
        command: '',
        program: 'history.reviseStep(2,"2*x=10");',
        message: '',
      })
    ).passed,
  ).toBe(true);
  expect(
    (
      await assessPromptAnswer(example, {
        status: 'command',
        command: '',
        program: 'problem.save(math.equation("2*x=10"));',
        message: '',
      })
    ).passed,
  ).toBe(false);
});

test('prompt comparison checks engine query values without accepting a state mutation', async () => {
  const example = promptCases.find((item) => item.id === 'statistics')!;
  expect(
    (
      await assessPromptAnswer(example, {
        status: 'command',
        command: '',
        program: 'statistics.mean(statistics.current());',
        message: '',
      })
    ).passed,
  ).toBe(true);
  expect(
    (
      await assessPromptAnswer(example, {
        status: 'command',
        command: '',
        program: 'problem.save(statistics.data([5,5]));',
        message: 'Mean: 5.',
      })
    ).passed,
  ).toBe(false);
});

import { expect, test } from 'vitest';
import {
  createProblemLibrary,
  currentProblem,
  decodeProblemLibrary,
  otherBranches,
  switchBranch,
} from '../index.ts';
import type { CloudProblemLibrary } from '../types/cloud-problem-library.ts';
import { applyCloudOperation } from './cloud-problem-library.ts';

test('revising an earlier equation keeps the later branch across reload and switching', async () => {
  let saved: CloudProblemLibrary = {
    book: createProblemLibrary(),
    clarification: null,
  };
  for (const text of [
    'write 2*x+3=11',
    'subtract three from both sides',
    'divide both sides by two',
  ])
    saved = await applyCloudOperation(saved, {
      kind: 'command',
      text,
      interpret: false,
    });
  const original = currentProblem(saved.book).steps;
  const revised = await applyCloudOperation(saved, {
    kind: 'revise-step',
    step: 2,
    expression: '2*x=10',
  });
  expect(currentProblem(revised.book).steps).toHaveLength(2);
  expect(currentProblem(revised.book).state.expression).toBe('2 * x = 10');
  const reloaded = decodeProblemLibrary(JSON.stringify(revised.book));
  expect(otherBranches(currentProblem(reloaded))).toHaveLength(1);
  const switched = switchBranch(reloaded, 0);
  expect(currentProblem(switched).steps).toEqual(original);
  expect(otherBranches(currentProblem(switched))[0].state.expression).toBe(
    '2 * x = 10',
  );
  expect(currentProblem(switchBranch(switched, 0)).state.expression).toBe(
    '2 * x = 10',
  );
});

test('invalid revisions leave work untouched and reject non-equations and invalid step numbers', async () => {
  const saved = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write x=4' },
  );
  const original = JSON.stringify(saved.book);
  for (const operation of [
    { kind: 'revise-step' as const, step: 0, expression: 'x=3' },
    { kind: 'revise-step' as const, step: 2, expression: 'x=3' },
    { kind: 'revise-step' as const, step: 1, expression: 'new problem' },
    { kind: 'revise-step' as const, step: 1, expression: 'x= (' },
  ])
    await expect(applyCloudOperation(saved, operation)).rejects.toThrow();
  expect(JSON.stringify(saved.book)).toBe(original);
});

test('a natural-language AI request revises a named step and preserves the original work', async () => {
  let saved: CloudProblemLibrary = {
    book: createProblemLibrary(),
    clarification: null,
  };
  for (const text of [
    'write 2*x+3=11',
    'subtract three from both sides',
    'simplify',
  ])
    saved = await applyCloudOperation(saved, { kind: 'command', text });
  const original = currentProblem(saved.book).steps;
  const revised = await applyCloudOperation(
    saved,
    {
      kind: 'command',
      text: 'Change step two to 2x equals ten',
      interpret: true,
    },
    async () => ({
      status: 'command',
      command: '',
      message: '',
      program: 'history.reviseStep(2, "2*x=10");',
    }),
  );
  expect(revised.status).toBe('command');
  expect(currentProblem(revised.book).state.expression).toBe('2 * x = 10');
  expect(currentProblem(revised.book).steps).toHaveLength(2);
  expect(
    currentProblem(
      switchBranch(decodeProblemLibrary(JSON.stringify(revised.book)), 0),
    ).steps,
  ).toEqual(original);
  for (const source of [
    'history.reviseStep(99, "x=4");',
    'history.reviseStep(1, "x=(");',
  ]) {
    const rejected = await applyCloudOperation(
      saved,
      {
        kind: 'command',
        text: 'Change the earlier step',
        interpret: true,
      },
      async () => ({
        status: 'command',
        command: '',
        message: '',
        program: source,
      }),
    );
    expect(currentProblem(rejected.book).steps).toEqual(original);
  }
});

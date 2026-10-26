import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { gradeCurrentContract } from './current-contract-grade.ts';
import type { Case } from './grade.ts';
const cases = (name: string): Case[] =>
  readFileSync(`../Evals/inputs/${name}.jsonl`, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
test('current scoring recognizes a validated program save without requiring legacy prose', () => {
  const item = cases('test-v2').find((c) => c.id === 'fresh-009')!;
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: '',
      program:
        'problem.save(math.replace(problem.currentEquation(),"13","15"));',
      message: '',
    }).pass,
  ).toBe(true);
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: '',
      program:
        'problem.save(math.replace(problem.currentEquation(),"13","16"));',
      message: '',
    }).pass,
  ).toBe(false);
});
test('temporary statistics queries preserve data and return the requested engine result', () => {
  const item = cases('test').find((c) => c.id === 'test-001')!;
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: '',
      program: 'statistics.median(statistics.data([2,4,8,10]));',
      message: '',
    }).pass,
  ).toBe(true);
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: '',
      program: 'statistics.mean(statistics.data([2,4,8,10]));',
      message: '',
    }).pass,
  ).toBe(false);
});
test('clarification wording differences stay marked for review rather than automatic passes', () => {
  const item = cases('test-v2').find((c) => c.id === 'fresh-001')!;
  const score = gradeCurrentContract(item, {
    status: 'clarification',
    command: '',
    message: 'Which number should I change?',
  });
  expect(score.pass).toBe(false);
  expect(score.classification).toBe('clarification-wording-review');
});

test('current query scoring rejects saving instead of returning an answer', () => {
  const item = cases('test').find((c) => c.id === 'test-001')!;
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: item.expected.command!,
      message: '',
    }).pass,
  ).toBe(false);
  const current = {
    ...item,
    expected: { status: 'command' as const, command: 'mean' },
  };
  expect(
    gradeCurrentContract(current, {
      status: 'command',
      command: '',
      program: 'problem.save(statistics.current());',
      message: '',
    }).pass,
  ).toBe(false);
});

test('graph representation normalization preserves the graph collection and other state', () => {
  const item = cases('test-v6').find((c) => c.id === 'v6-001')!;
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: '',
      program: 'problem.save(graph.add(graph.current(1),"3*x+2"));',
      message: '',
    }).pass,
  ).toBe(true);
  expect(
    gradeCurrentContract(item, {
      status: 'command',
      command: '',
      program: 'problem.save(graph.plot("3*x+2"));',
      message: '',
    }).pass,
  ).toBe(false);
});

import { describe, expect, it } from 'vitest';
import {
  buildConversationRows,
  exportDataset,
  deduplicatePrompts,
} from './export_dataset.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('training conversation export', () => {
  it('keeps authored actions and prior student context without parser shortcuts', async () => {
    const result = await buildConversationRows(
      {
        id: 'fixture',
        family: 'fixture',
        category: 'algebra',
        focus: 'editing',
        turns: [
          {
            student: 'Write x plus three equals eight.',
            programs: ['problem.save(math.equation("x+3=8"));'],
            expect: { expression: 'x + 3 = 8' },
          },
          {
            student: 'Take three from both sides.',
            programs: [
              'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
            ],
            expect: { expression: 'x + 3 - 3 = 8 - 3' },
          },
        ],
      },
      'train',
    );
    expect(result.exclusion).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].request.conversation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          request: 'Write x plus three equals eight.',
        }),
      ]),
    );
    expect(
      result.rows[1].expected.after.book.assignments[0].problems[0].state
        .expression,
    ).toBe('x + 3 - 3 = 8 - 3');
    expect(
      JSON.parse(result.rows[1].messages.at(-1)!.content).programs,
    ).toEqual([
      'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
    ]);
  });
});

it('retains real preview observations and read-only outcomes', async () => {
  const result = await buildConversationRows(
    {
      id: 'query',
      family: 'query',
      category: 'algebra',
      focus: 'read-only',
      turns: [
        {
          student: 'Write two x equals ten.',
          programs: ['problem.save(math.equation("2*x=10"));'],
          expect: { expression: '2 * x = 10' },
        },
        {
          student: 'What is x without changing my work?',
          programs: [],
          status: 'explanation',
          message: 'x = 5.',
          previews: ['math.solve(problem.currentEquation());'],
          expect: { readOnly: true, stepDelta: 0, messageIncludes: ['x = 5'] },
        },
      ],
    },
    'test',
  );
  expect(result.exclusion).toBeUndefined();
  expect(result.rows.map((row) => row.stage)).toEqual([
    'final',
    'preview',
    'final',
  ]);
  const final = result.rows.at(-1)!;
  const observations = JSON.parse(
    final.messages.at(-2)!.content,
  ).toolObservations;
  expect(observations[0].output.messages.join(' ')).toContain('x = 5');
  expect(
    final.expected.after.book.assignments[0].problems[0].steps,
  ).toHaveLength(1);
});

it('excludes the whole dependent case when an authored answer is wrong', async () => {
  const result = await buildConversationRows(
    {
      id: 'wrong',
      family: 'wrong',
      category: 'algebra',
      focus: 'invalid reference',
      turns: [
        {
          student: 'Write x equals two.',
          programs: ['problem.save(math.equation("x=2"));'],
          expect: { expression: 'x = 99' },
        },
        {
          student: 'Add one.',
          programs: [
            'problem.save(math.addBothSides(problem.currentEquation(),1));',
          ],
        },
      ],
    },
    'val',
  );
  expect(result.rows).toEqual([]);
  expect(result.exclusion).toMatchObject({
    caseId: 'wrong',
    failedTurn: 1,
    excludedTurns: 2,
  });
  expect(result.exclusion?.reason).toContain('expected "x = 99", got "x = 2"');
});

it('preserves correction undo metadata while restoring student wording', async () => {
  const result = await buildConversationRows(
    {
      id: 'correction',
      family: 'correction',
      category: 'algebra',
      focus: 'correction',
      turns: [
        {
          student: 'Write x plus three equals eight.',
          programs: ['problem.save(math.equation("x+3=8"));'],
        },
        {
          student: 'Subtract two from both sides.',
          programs: [
            'problem.save(math.subtractBothSides(problem.currentEquation(),2));',
          ],
        },
        {
          student: 'Wait, I meant subtract three instead.',
          status: 'correction',
          programs: [
            'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
          ],
          expect: { expression: 'x + 3 - 3 = 8 - 3' },
        },
      ],
    },
    'train',
  );
  expect(result.exclusion).toBeUndefined();
  const final = result.rows.at(-1)!;
  expect(
    final.expected.after.book.assignments[0].problems[0].conversation?.at(-1),
  ).toMatchObject({
    request: 'Wait, I meant subtract three instead.',
    status: 'correction',
    undoDepth: 2,
  });
});

it('refuses to overwrite an existing experiment directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mathwave-export-test-'));
  const marker = join(directory, 'manifest.json');
  try {
    await writeFile(marker, 'preserve this run');
    await expect(exportDataset(directory)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(marker, 'utf8')).toBe('preserve this run');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps duplicate inputs only in the highest-priority partition and reports distinct targets', async () => {
  const scenario = {
    id: 'same-input',
    family: 'same-input',
    category: 'algebra',
    focus: 'same input',
    turns: [
      {
        student: 'Write x equals two.',
        programs: ['problem.save(math.equation("x=2"));'],
      },
    ],
  };
  const row = (await buildConversationRows(scenario, 'train')).rows[0];
  const train = {
    ...row,
    id: 'train-row',
    caseId: 'train-case',
    split: 'train' as const,
  };
  const validation = {
    ...row,
    id: 'val-row',
    caseId: 'val-case',
    split: 'val' as const,
  };
  const test = {
    ...row,
    id: 'test-row',
    caseId: 'test-case',
    split: 'test' as const,
  };
  const otherTarget = {
    ...test,
    id: 'test-repeat',
    messages: [
      ...test.messages.slice(0, -1),
      {
        role: 'assistant' as const,
        content: JSON.stringify({
          status: 'command',
          programs: ['problem.save(math.equation("2=x"));'],
          message: '',
          presentation: null,
        }),
      },
    ],
  };
  const result = deduplicatePrompts({
    train: [train],
    val: [validation],
    test: [test, otherTarget],
  });
  expect(result.rows.train).toEqual([]);
  expect(result.rows.val).toEqual([]);
  expect(result.rows.test.map((value) => value.id)).toEqual([
    'test-row',
    'test-repeat',
  ]);
  expect(result.removed.map((value) => value.id)).toEqual([
    'val-row',
    'train-row',
  ]);
  expect(result.primaryUniqueIds.test).toEqual(['test-row']);
  expect(result.conflictingTargets).toHaveLength(1);
  expect(result.conflictingTargets[0].rows.map((value) => value.id)).toContain(
    'train-row',
  );
  expect(train.expected.before.book).toBe(row.expected.before.book);
});

import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { executeReferenceTurn } from './export_dataset.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  rememberConversation,
} from '../../../Web/src/modules/problems/index.ts';
import {
  gradePrediction,
  gradeFiles,
  semanticallyEqual,
  type ExperimentRow,
} from './grade_predictions.ts';

const answer = (programs: string[], status = 'command', message = '') => ({
  status,
  programs,
  message,
  presentation: null,
});

/** A literal reference for writing x = 5, independent of the generated program. */
function equationRow(): ExperimentRow {
  const book = createProblemLibrary();
  const written = recordStep(
    book,
    { ...currentProblem(book).state, mode: 'equation', expression: 'x = 5' },
    'write x=5',
  );
  const after = rememberConversation(
    book,
    written,
    'Write x equals five.',
    '',
    'command',
  );
  return {
    id: 'literal-equation',
    caseId: 'equation',
    category: 'equations',
    family: 'write',
    turn: 1,
    stage: 'final',
    split: 'test',
    request: { request: 'Write x equals five.' },
    messages: [
      {
        role: 'assistant',
        content: JSON.stringify(
          answer(['problem.save(math.equation("x=5"));']),
        ),
      },
    ],
    expected: {
      interpretation: answer([]),
      before: { book, clarification: null },
      after: { book: after, status: 'command', message: '' },
      assertions: { expression: 'x = 5', stepDelta: 1 },
    },
  };
}

test('grades equivalent generated DSL by saved work instead of exact target spelling', async () => {
  const row = equationRow();
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify({
      answer: answer([
        'const equation = math.equation("x=5"); problem.save(equation);',
      ]),
    }),
  });
  expect(result.syntaxValid).toBe(true);
  expect(result.exactTarget).toBe(false);
  expect(result.reasons).toEqual([]);
  expect(result.pass).toBe(true);
  expect(currentProblem(result.book!).state.expression).toBe('x = 5');
  expect(currentProblem(row.expected.before.book).steps).toHaveLength(0);
});

test('cannot count a recognizable student request as success when model JSON is invalid', async () => {
  const row = equationRow();
  row.request.request = 'write x=5';
  const result = await gradePrediction(row, {
    id: row.id,
    prediction:
      '{"status":"command","programs":["missing();"],"message":"","presentation":null}',
  });
  expect(result.syntaxValid).toBe(false);
  expect(result.pass).toBe(false);
  expect(result.book).toBeUndefined();
});

test('rejects a valid proposal with a wrong mathematical result', async () => {
  const row = equationRow();
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(answer(['problem.save(math.equation("x=6"));'])),
  });
  expect(result.syntaxValid).toBe(true);
  expect(result.semanticCorrect).toBe(false);
  expect(result.pass).toBe(false);
});

test('grades previews through real engine observations and preserves saved work', async () => {
  const row = equationRow();
  const book = recordStep(
    row.expected.before.book,
    {
      ...currentProblem(row.expected.before.book).state,
      mode: 'statistics',
      data: [2, 4, 9],
    },
    'data 2,4,9',
  );
  row.stage = 'preview';
  row.expected.before.book = book;
  row.expected.after.book = book;
  const calls = [
    {
      id: 'mean',
      name: 'preview_math',
      arguments: JSON.stringify({
        program: 'statistics.mean(statistics.current());',
        programs: [],
      }),
    },
  ];
  row.messages = [{ role: 'assistant', content: JSON.stringify({ calls }) }];
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify({
      calls: [{ ...calls[0], id: 'different-id' }],
    }),
  });
  expect(result.pass).toBe(true);
  expect(result.exactTarget).toBe(false);
  expect(result.observations).toEqual([
    expect.objectContaining({
      applied: false,
      messages: [expect.stringContaining('5')],
    }),
  ]);
  expect(currentProblem(result.book!).steps).toHaveLength(1);
});

test('a reply containing 15 cannot satisfy an authored answer of 5', async () => {
  const row = equationRow();
  row.expected.after = {
    book: row.expected.before.book,
    status: 'explanation',
    message: 'The mean is 5.',
  };
  row.expected.assertions = { readOnly: true, messageIncludes: ['5'] };
  row.request.request = 'Explain the average without changing anything.';
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(answer([], 'explanation', 'The mean is 15.')),
  });
  expect(result.syntaxValid).toBe(true);
  expect(result.groundedReplyAssertionsSatisfied).toBe(false);
  expect(result.pass).toBe(false);
});

test('semantic number comparison does not equate missing values or changed array order', () => {
  expect(semanticallyEqual({ a: 5 }, { a: 5.00000001 })).toBe(true);
  expect(semanticallyEqual({ a: 5 }, {})).toBe(false);
  expect(semanticallyEqual([2, 4], [4, 2])).toBe(false);
});

test('same final equation with an extra persisted step fails the history contract', async () => {
  const row = equationRow();
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(
      answer([
        'problem.save(math.equation("x=4"));',
        'problem.save(math.equation("x=5"));',
      ]),
    ),
  });
  expect(result.syntaxValid).toBe(true);
  expect(currentProblem(result.book!).state.expression).toBe('x = 5');
  expect(currentProblem(result.book!).steps).toHaveLength(2);
  expect(result.semanticCorrect).toBe(false);
});

test('a token-limit completion cannot pass even when its JSON happens to be complete', async () => {
  const row = equationRow();
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: row.messages[0].content,
    hitTokenLimit: true,
  });
  expect(result.syntaxValid).toBe(true);
  expect(result.semanticCorrect).toBe(false);
  expect(result.pass).toBe(false);
});

test('a negated reference number plus a contradictory number cannot pass reply grounding', async () => {
  const row = equationRow();
  row.expected.after = {
    book: row.expected.before.book,
    status: 'explanation',
    message: 'The mean is 5.',
  };
  row.expected.assertions = { readOnly: true, messageIncludes: ['5'] };
  row.request.request = 'Explain the average without changing anything.';
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(
      answer([], 'explanation', 'The mean is not 5, it is 99.'),
    ),
  });
  expect(result.syntaxValid).toBe(true);
  expect(result.semanticCorrect).toBe(false);
  expect(result.pass).toBe(false);
});

test('grading refuses to overwrite an existing historical report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mathwave-grader-'));
  try {
    const data = join(directory, 'data.jsonl'),
      predictions = join(directory, 'predictions.jsonl'),
      output = join(directory, 'report.json');
    const row = equationRow();
    await writeFile(data, JSON.stringify(row) + '\n');
    await writeFile(
      predictions,
      JSON.stringify({ id: row.id, prediction: row.messages[0].content }) +
        '\n',
    );
    await writeFile(output, 'historic evidence\n');
    await expect(gradeFiles(data, predictions, output)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('historic evidence\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a read-only suggestion must retain executable proposed steps for later acceptance', async () => {
  const row = equationRow();
  row.expected.before.book = row.expected.after.book;
  const book = row.expected.before.book;
  const program =
    'problem.save(math.subtractBothSides(problem.currentEquation(),1));';
  const message = 'Subtract one from both sides.';
  row.request.request = 'Suggest subtracting one without applying it.';
  row.expected.after = {
    book: rememberConversation(
      book,
      book,
      row.request.request,
      message,
      'explanation',
      ['typescript\n' + program],
    ),
    status: 'explanation',
    message,
  };
  row.expected.assertions = { readOnly: true, stepDelta: 0 };
  row.messages = [
    {
      role: 'assistant',
      content: JSON.stringify(answer([program], 'explanation', message)),
    },
  ];
  const missing = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(answer([], 'explanation', message)),
  });
  expect(missing.syntaxValid).toBe(true);
  expect(missing.semanticCorrect).toBe(false);
  expect(missing.reasons).toContain(
    'Pending suggestion or correction revision metadata differs.',
  );
  const equivalent = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(
      answer(
        [
          'const current = problem.currentEquation(); problem.save(math.subtractBothSides(current,1));',
        ],
        'explanation',
        message,
      ),
    ),
  });
  expect(equivalent.reasons).toEqual([]);
  expect(equivalent.pass).toBe(true);
});

test('corrections execute against restored work and retain their revision depth', async () => {
  const row = equationRow();
  const book = row.expected.after.book;
  const request = 'Actually I meant x equals four.';
  const proposal = answer(
    ['problem.save(math.equation("x=4"));'],
    'correction',
  );
  row.expected.before.book = book;
  row.expected.after = await executeReferenceTurn(book, request, proposal);
  row.expected.assertions = { expression: 'x = 4', stepDelta: 0 };
  row.request.request = request;
  row.messages = [{ role: 'assistant', content: JSON.stringify(proposal) }];
  const result = await gradePrediction(row, {
    id: row.id,
    prediction: JSON.stringify(proposal),
  });
  expect(result.reasons).toEqual([]);
  expect(result.pass).toBe(true);
  expect(currentProblem(result.book!).state.expression).toBe('x = 4');
  expect(currentProblem(result.book!).conversation?.at(-1)?.undoDepth).toBe(2);
});

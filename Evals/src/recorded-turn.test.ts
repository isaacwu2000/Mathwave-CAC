import { expect, test } from 'vitest';
import {
  applyCloudOperation,
  createProblemLibrary,
  rememberConversation,
} from '../../Web/src/modules/problems/index.ts';
import { assessRecordedTurn } from './recorded-turn.ts';

test('recorded case grading rejects a repeated operation and preserves read-only work', async () => {
  const before = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'write 2*x+3=11' },
  );
  const example = {
    id: 'step',
    setup: [],
    expectedCommand: 'subtract 3 from both sides',
  };
  const once = await applyCloudOperation(before, {
    kind: 'command',
    text: example.expectedCommand,
  });
  expect((await assessRecordedTurn(before, once, example)).passed).toBe(true);
  const twice = await applyCloudOperation(once, {
    kind: 'command',
    text: example.expectedCommand,
  });
  expect((await assessRecordedTurn(before, twice, example)).passed).toBe(false);
  const read = await applyCloudOperation(before, {
    kind: 'command',
    text: 'read equation',
  });
  expect(
    (
      await assessRecordedTurn(before, read, {
        ...example,
        expectedCommand: 'read equation',
      })
    ).passed,
  ).toBe(true);
  expect(
    (
      await assessRecordedTurn(before, once, {
        ...example,
        expectedCommand: 'read equation',
      })
    ).passed,
  ).toBe(false);
});

test('read-only geometry accepts a correct explained answer and rejects the wrong length', async () => {
  const before = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'right triangle a 3 b 4' },
  );
  const reply = (message: string) => ({
    ...before,
    book: rememberConversation(
      before.book,
      before.book,
      'Find the hypotenuse.',
      message,
      'explanation',
    ),
  });
  const example = {
    id: 'hypotenuse',
    setup: [],
    expectedCommand: 'hypotenuse',
  };
  expect(
    (
      await assessRecordedTurn(
        before,
        reply('The hypotenuse is 5 units.'),
        example,
      )
    ).passed,
  ).toBe(true);
  expect(
    (
      await assessRecordedTurn(
        before,
        reply('The hypotenuse is 6 units.'),
        example,
      )
    ).passed,
  ).toBe(false);
});

test('intercepts require both signed roots, not two matches of the same negative root', async () => {
  const before = await applyCloudOperation(
    { book: createProblemLibrary(), clarification: null },
    { kind: 'command', text: 'graph y=x^2-4' },
  );
  const reply = (message: string) => ({
    ...before,
    book: rememberConversation(
      before.book,
      before.book,
      'Find the x intercepts.',
      message,
      'explanation',
    ),
  });
  const example = {
    id: 'intercepts',
    setup: [],
    expectedCommand: 'find roots',
  };
  expect(
    (
      await assessRecordedTurn(
        before,
        reply('The only x intercept is negative two.'),
        example,
      )
    ).passed,
  ).toBe(false);
  expect(
    (
      await assessRecordedTurn(
        before,
        reply('The roots are negative two and positive two.'),
        example,
      )
    ).passed,
  ).toBe(true);
  expect(
    (
      await assessRecordedTurn(
        before,
        reply('The roots are -2 and -2.'),
        example,
      )
    ).passed,
  ).toBe(false);
  for (const message of [
    'The roots are -2.5 and 2.5.',
    'The roots are negative two point five and positive two point five.',
  ])
    expect(
      (await assessRecordedTurn(before, reply(message), example)).passed,
    ).toBe(false);
});

test('an inline median query returns six without saving the supplied list', async () => {
  const before = { book: createProblemLibrary(), clarification: null };
  const example = {
    id: 'median',
    setup: [],
    expectedCommand: 'median of 2,4,8,10',
    readOnly: true,
    answerPatterns: ['median', '\\b(?:6|six)\\b'],
  };
  const reply = (message: string) => ({
    ...before,
    book: rememberConversation(
      before.book,
      before.book,
      'Find the median of two, four, eight, ten.',
      message,
      'explanation',
    ),
  });
  expect(
    (await assessRecordedTurn(before, reply('The median is 6.'), example))
      .passed,
  ).toBe(true);
  expect(
    (await assessRecordedTurn(before, reply('The median is 7.'), example))
      .passed,
  ).toBe(false);
  const savedList = await applyCloudOperation(before, {
    kind: 'command',
    text: example.expectedCommand,
  });
  expect((await assessRecordedTurn(before, savedList, example)).passed).toBe(
    false,
  );
});

test('recorded explicit graphs accept y wrappers while rejecting different curves', async () => {
  const before = { book: createProblemLibrary(), clarification: null };
  const scenario = {
    id: 'function',
    setup: [],
    expectedCommand: 'graph y=x^2-4',
  };
  const actual = await applyCloudOperation(before, {
    kind: 'command',
    text: 'typescript\nproblem.save(graph.plot("x^2-4"));',
  });
  expect((await assessRecordedTurn(before, actual, scenario)).passed).toBe(
    true,
  );
  const wrong = await applyCloudOperation(before, {
    kind: 'command',
    text: 'typescript\nproblem.save(graph.plot("x^2+4"));',
  });
  expect((await assessRecordedTurn(before, wrong, scenario)).passed).toBe(
    false,
  );
});

import { comparableGraphState } from './current-contract-grade.ts';
import {
  applyCloudOperation,
  currentProblem,
} from '../../Web/src/modules/problems/index.ts';
import { parseMath, simplifyMath } from '../../Web/src/modules/math/index.ts';
import { isDeepStrictEqual } from 'node:util';

export type RecordedScenario = {
  id: string;
  setup: string[];
  expectedCommand: string;
  expectedCommands?: string[];
  expectedStatus?: string;
  readOnly?: boolean;
  answerPatterns?: string[];
  clarification?: { request: string; question: string };
};

/** Compares intended operations through the public command engine, including saved history.
 * Expected commands stay local to the grader. This checks intent, not independent engine mathematics.
 */
export async function assessRecordedTurn(
  before: Parameters<typeof applyCloudOperation>[0],
  after: Parameters<typeof applyCloudOperation>[0],
  scenario: RecordedScenario,
) {
  let expected = before;
  for (const text of scenario.readOnly
    ? []
    : (scenario.expectedCommands ?? [scenario.expectedCommand]))
    expected = await applyCloudOperation(expected, { kind: 'command', text });
  const previous = currentProblem(before.book);
  const actual = currentProblem(after.book);
  const target = currentProblem(expected.book);
  const normalized = (state: typeof actual.state) =>
    state.graph && !state.graphScene
      ? comparableGraphState(state)
      : {
          ...state,
          expression: state.expression
            ? simplifyMath(parseMath(state.expression))
            : '',
        };
  const equal = isDeepStrictEqual;
  const mathMatches = equal(normalized(actual.state), normalized(target.state));
  const historyMatches =
    actual.steps.length === target.steps.length &&
    equal(actual.steps.slice(0, previous.steps.length), previous.steps) &&
    (target.steps.length !== previous.steps.length ||
      (equal(actual.undoStates, previous.undoStates) &&
        equal(actual.undoRevisions, previous.undoRevisions) &&
        equal(actual.redoRevisions, previous.redoRevisions)));
  const response = actual.conversation?.at(-1);
  const readOnly = target.steps.length === previous.steps.length;
  const statusMatches =
    scenario.expectedStatus === 'clarification'
      ? response?.status === 'clarification' &&
        Boolean(after.clarification?.question.trim())
      : !after.clarification &&
        (response?.status === 'command' ||
          (readOnly &&
            ['reply', 'explanation'].includes(response?.status ?? '')));
  // Independent facts permit natural answer wording without accepting a different calculation.
  const facts: Record<string, RegExp[]> = {
    hypotenuse: [/hypotenuse/i, /\b(?:5|five)\b/i],
    angle: [/\b(?:90|ninety)\b/i],
    point: [/\b(?:5|five)\b/i],

    volume: [/(?:20\s*\*?\s*(?:pi|π)|twenty\s*(?:pi|π)|62\.83)/i],
  };
  // Read whole signed values so neither -2 nor 2.5 can also count as +2.
  const digitWords: Record<string, string> = {
    zero: '0',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
  };
  const rootText = (response?.response ?? '')
    .toLowerCase()
    .replace(/\b(?:negative|minus)\b/g, '-')
    .replace(/\b(?:positive|plus)\b/g, '+')
    .replace(/\bpoint\b/g, '.')
    .replace(
      /\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/g,
      (word) => digitWords[word],
    );
  const rootClaims = [
    ...rootText.matchAll(
      /[−+-]?\s*\d+(?:\s*\.\s*\d+)?(?:\s+(?:hundred|thousand|million))?/g,
    ),
  ].map(([claim]) => Number(claim.replace(/\s/g, '').replace('−', '-')));
  const answerMatches =
    !readOnly ||
    scenario.expectedStatus === 'clarification' ||
    (scenario.answerPatterns
      ? scenario.answerPatterns.every((pattern) =>
          new RegExp(pattern, 'i').test(response?.response ?? ''),
        )
      : scenario.id === 'intercepts'
        ? rootClaims.includes(-2) && rootClaims.includes(2)
        : facts[scenario.id]
          ? facts[scenario.id].every((pattern) =>
              pattern.test(response?.response ?? ''),
            )
          : response?.response.includes(
              target.conversation?.at(-1)?.response ?? '\0',
            ) === true);
  return {
    passed: mathMatches && historyMatches && statusMatches && answerMatches,
    mathMatches,
    historyMatches,
    statusMatches,
    answerMatches,
    expectedState: target.state,
    actualState: actual.state,
    response: response?.response,
    beforeProblem: previous,
    afterProblem: actual,
  };
}

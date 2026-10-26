import { initialWorkspace, type Workspace } from '../../Web/src/modules/workspace/state.ts';
import { runCommand } from '../../Web/src/modules/commands/index.ts';
import { resolveClarification, type ClarificationContext } from '../../Web/src/modules/commands/index.ts';
import { ClarificationError } from '../../Web/src/modules/math/index.ts';
import graphCases from '../inputs/recorded-graph-geometry/cases.json' with { type: 'json' };

export type Recording = {
  voice: string;
  case: string;
  audio: string;
  transcript: string;
  expectedCommand: string;
  sha256: string;
};
type Scenario = {
  id: string;
  setup: string[];
  expectedCommand: string;
  expectedCommands?: string[];
  expectedStatus?: string;
  clarification?: ClarificationContext;
};
export type RecordingResult = {
  language?: string;
  voice: string;
  case: string;
  audio: string;
  sha256: string;
  transcript: string;
  passed: boolean;
  status: string;
  message: string;
};
const algebra: Scenario[] = [
  { id: 'equation', setup: [], expectedCommand: 'write 2*x + 3 = 11' },
  {
    id: 'step',
    setup: ['write 2*x + 3 = 11'],
    expectedCommand: 'subtract 3 from both sides',
  },
  { id: 'median', setup: [], expectedCommand: 'median of 2, 4, 8, 10' },
  {
    id: 'outliers',
    setup: ['data 4,5,5,6,7,8,22'],
    expectedCommand: 'find outliers',
  },
];
const snapshot = (s: Workspace) => JSON.stringify(s);
export function evaluateRecording(
  clip: Recording,
  transcript: string,
): RecordingResult {
  const scenario = [...algebra, ...(graphCases as Scenario[])].find(
    (item) => item.id === clip.case,
  );
  if (!scenario) throw new Error('Unknown recording scenario.');
  let start = structuredClone(initialWorkspace);
  for (const command of scenario.setup)
    start = runCommand(start, command).state;
  let expectedState = start,
    expectedMessage = '';
  if (scenario.expectedStatus !== 'clarification') {
    for (const command of scenario.expectedCommands ?? [
      scenario.expectedCommand,
    ]) {
      const result = runCommand(expectedState, command);
      expectedState = result.state;
      expectedMessage = result.message;
    }
  }
  const base = {
    voice: clip.voice,
    case: clip.case,
    audio: clip.audio,
    sha256: clip.sha256,
    transcript,
  };
  try {
    const command =
      resolveClarification(scenario.clarification, transcript) ?? transcript;
    const actual = runCommand(start, command);
    return {
      ...base,
      passed:
        scenario.expectedStatus !== 'clarification' &&
        snapshot(actual.state) === snapshot(expectedState) &&
        actual.message === expectedMessage,
      status: 'command',
      message: actual.message,
    };
  } catch (error) {
    const status =
      error instanceof ClarificationError ? 'clarification' : 'unsupported';
    return {
      ...base,
      passed: scenario.expectedStatus === status,
      status,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

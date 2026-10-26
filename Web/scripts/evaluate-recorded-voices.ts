import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runCommand } from '../src/modules/commands/index.ts';
import { initialWorkspace, type Workspace } from '../src/modules/workspace/state.ts';
import { resolveClarification, type ClarificationContext } from '../src/modules/commands/index.ts';
import { ClarificationError } from '../src/modules/math/index.ts';
type Case = {
  id: string;
  setup: string[];
  expectedCommand: string;
  expectedCommands?: string[];
  expectedStatus?: string;
  clarification?: ClarificationContext;
};
const cases: Case[] = JSON.parse(
  readFileSync('../Evals/inputs/recorded-graph-geometry/cases.json', 'utf8'),
);
const input =
  process.argv[2] ?? '../Evals/inputs/recorded-graph-geometry/transcripts.json';
const output = process.argv[3] ?? '../Evals/evaluations/recorded-graph-geometry/results.json';
const recording = JSON.parse(readFileSync(input, 'utf8'));
const snapshot = (s: Workspace) =>
  JSON.stringify({
    mode: s.mode,
    expression: s.expression,
    geometry: s.geometry,
    graph: s.graph,
    graphRange: s.graphRange,
  });
const rows = recording.clips.map(
  (clip: {
    voice: string;
    case: string;
    transcript: string;
    sha256: string;
  }) => {
    const item = cases.find((c) => c.id === clip.case)!;
    if (!item) throw new Error('Unknown recording case');
    let state = structuredClone(initialWorkspace);
    for (const setup of item.setup) state = runCommand(state, setup).state;
    let expected;
    if (item.expectedStatus !== 'clarification') {
      let result;
      for (const command of item.expectedCommands ?? [item.expectedCommand]) {
        result = runCommand(state, command);
        state = result.state;
      }
      expected = result!;
    }
    let start = structuredClone(initialWorkspace);
    for (const setup of item.setup) start = runCommand(start, setup).state;
    const command =
      resolveClarification(item.clarification, clip.transcript) ??
      clip.transcript;
    try {
      const actual = runCommand(start, command);
      const stateMatches =
        expected && snapshot(expected.state) === snapshot(actual.state);
      const messageMatches = expected && expected.message === actual.message;
      return {
        ...clip,
        status: 'command',
        command,
        passed: Boolean(stateMatches && messageMatches),
        stateMatches,
        messageMatches,
        message: actual.message,
        state: actual.state,
      };
    } catch (error) {
      const status =
        error instanceof ClarificationError ? 'clarification' : 'unsupported';
      return {
        ...clip,
        status,
        command,
        passed: item.expectedStatus === status,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
);
const report = {
  recognizer: recording.recognizer,
  scope: recording.scope,
  total: rows.length,
  passed: rows.filter((r: { passed: boolean }) => r.passed).length,
  expectedClarifications: rows.filter(
    (r: { passed: boolean; status: string }) =>
      r.passed && r.status === 'clarification',
  ).length,
  unresolvedClarifications: rows.filter(
    (r: { passed: boolean; status: string }) =>
      !r.passed && r.status === 'clarification',
  ).length,
  incorrectActions: rows.filter(
    (r: { passed: boolean; status: string }) =>
      !r.passed && r.status === 'command',
  ).length,
  results: rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed}/${report.total} recorded commands passed`);
for (const row of rows.filter((r: { passed: boolean }) => !r.passed))
  console.log(`${row.voice} ${row.case}: ${row.transcript} -> ${row.message}`);

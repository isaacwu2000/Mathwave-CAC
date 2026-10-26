import {
  serverTimings,
  type JourneyTiming,
} from '../../Evals/src/journey-evaluation.ts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runCommand } from '../src/modules/commands/index.ts';
import { ClarificationError } from '../src/modules/math/index.ts';
import type { Interpretation } from '../src/modules/commands/index.ts';
import { grade, type Case } from '../../Evals/src/grade.ts';
const split = process.argv[2] || 'test';
const mode = process.argv[3] || 'parser';
if (
  !/^(?:train|test)(?:-v[1-9]\d*)?$/.test(split) ||
  !['parser', 'endpoint', 'predictions'].includes(mode)
)
  throw new Error(
    'Usage: evaluate.ts <train|test[-vN]> <parser|endpoint|predictions> [predictions.jsonl]',
  );
const data = readFileSync(`../Evals/inputs/${split}.jsonl`, 'utf8');
const cases: Case[] = data
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const supplied =
  mode === 'predictions'
    ? new Map(
        readFileSync(process.argv[4], 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const row = JSON.parse(line);
            return [row.id, row.prediction];
          }),
      )
    : new Map();
const results = [];
let unavailable = false;
for (const item of cases) {
  // Keep frozen flowchart cases as historical evidence of a retired feature.
  if (String(item.state.mode) === 'diagram' || item.category === 'diagram')
    continue;
  const start = performance.now();
  let prediction: Interpretation;
  let timings: JourneyTiming[] = [];
  try {
    if (mode === 'parser') {
      try {
        runCommand(structuredClone(item.state), item.utterance);
        prediction = {
          status: 'command',
          command: item.utterance,
          message: '',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unsupported';
        prediction = {
          status:
            error instanceof ClarificationError ||
            /sample.*population|ambiguous|exact.*unique/i.test(message)
              ? 'clarification'
              : 'unsupported',
          command: '',
          message,
        };
      }
    } else if (mode === 'predictions') {
      prediction = supplied.get(item.id);
      if (!prediction) throw new Error('Missing prediction');
    } else {
      if (unavailable)
        throw new Error('Provider unavailable; remaining calls skipped');
      const origin = process.env.EVAL_ORIGIN || 'http://localhost:3000';
      const response = await fetch(`${origin}/api/interpret`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.utterance,
          state: item.state,
          clarification: item.clarification,
        }),
        signal: AbortSignal.timeout(20000),
      });
      timings = serverTimings(response.headers.get('Server-Timing'));
      if (!response.ok) {
        if (![401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
          results.push({
            id: item.id,
            category: item.category,
            pass: false,
            timings,
            reason: `Endpoint rejected context or interpretation (HTTP ${response.status})`,
            latencyMs: Math.round(performance.now() - start),
          });
          await new Promise((resolve) => setTimeout(resolve, 6200));
          continue;
        }
        unavailable = true;
        throw new Error(`Endpoint HTTP ${response.status}`);
      }
      prediction = (await response.json()) as Interpretation;
      const latencyMs = Math.round(performance.now() - start);
      results.push({
        id: item.id,
        category: item.category,
        ...grade(item, prediction),
        prediction,
        latencyMs,
        timings,
      });
      // Stay below the app's per-user 10/minute budget.
      await new Promise((resolve) => setTimeout(resolve, 6200));
      continue;
    }
    results.push({
      id: item.id,
      category: item.category,
      ...grade(item, prediction, mode === 'parser' ? 'parser' : 'agent'),
      prediction,
      latencyMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    if (mode === 'endpoint') unavailable = true;
    results.push({
      id: item.id,
      category: item.category,
      pass: null,
      timings,
      reason: error instanceof Error ? error.message : 'Unavailable',
      latencyMs: Math.round(performance.now() - start),
    });
  }
}
const scored = results.filter((r) => r.pass !== null);
const passed = scored.filter((r) => r.pass).length;
const report = {
  split,
  mode,
  datasetSHA256: createHash('sha256').update(data).digest('hex'),
  createdAt: new Date().toISOString(),
  total: cases.length,
  scored: scored.length,
  passed,
  unavailable: cases.length - scored.length,
  accuracy: scored.length ? passed / scored.length : null,
  scope: 'Text command behavior only; no microphone or voice quality claims.',
  categories: Object.fromEntries(
    [...new Set(cases.map((c) => c.category))].map((category) => {
      const rows = scored.filter((r) => r.category === category);
      return [
        category,
        { passed: rows.filter((r) => r.pass).length, scored: rows.length },
      ];
    }),
  ),
  results,
};
mkdirSync('../Evals/evaluations', { recursive: true });
writeFileSync(
  `../Evals/evaluations/${split}-${mode}.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    split,
    mode,
    total: report.total,
    scored: report.scored,
    passed,
    unavailable: report.unavailable,
    accuracy: report.accuracy,
  }),
);
if (report.unavailable) process.exitCode = 2;

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  COMMAND_PROFILES,
  LIVE_MODEL,
} from '../../Web/src/modules/ai/index.ts';
import {
  currentProblem,
  type CloudSnapshot,
} from '../../Web/src/modules/problems/index.ts';
import {
  summarizeJourneys,
  serverTimings,
  type JourneySample,
} from '../src/journey-evaluation.ts';

import {
  backendCases,
  backendState,
  assessBackendAnswer,
} from '../src/backend-journey.ts';
import { summarizeCampaign } from '../src/campaign-summary.ts';
import {
  recordedScenarios,
  selectVoiceCampaign,
  voiceCatalog,
} from '../src/voice-catalog.ts';
import type { SelectionOptions } from '../src/case-selection.ts';
import { naturalVoiceCases } from '../src/natural-voice-conversation.ts';

const lane = process.argv[2] ?? 'http';
let repetitions = 1;
let profile = 'luna-default';
let selectedCases: string[] | undefined;
const selection: SelectionOptions = {};
let dryRun = false;
const args = process.argv.slice(3);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run' || args[i] === '--list') {
    dryRun = true;
    continue;
  }
  const value = args[++i];
  if (!value || value.startsWith('--')) throw new Error('Missing flag value.');
  const flag = args[i - 1];
  if (flag === '--repetitions') repetitions = Number(value);
  else if (flag === '--profile') profile = value;
  else if (flag === '--cases') selectedCases = value.split(',');
  else if (flag === '--categories') selection.categories = value.split(',');
  else if (flag === '--sample') selection.sample = Number(value);
  else if (flag === '--seed') selection.seed = value;
  else throw new Error(`Unknown evaluation flag: ${flag}`);
}
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error('Use --repetitions 1–20.');
if (!Object.hasOwn(COMMAND_PROFILES, profile))
  throw new Error('Unknown command profile.');
if (lane !== 'suite' && (dryRun || Object.keys(selection).length))
  throw new Error(
    'Category sampling and dry-run currently use the suite lane.',
  );
selection.cases = selectedCases;
if (lane === 'suite') selection.seed ??= randomUUID();
const campaign = lane === 'suite' ? selectVoiceCampaign(selection) : [];
if (lane === 'suite' && dryRun) {
  console.log(
    JSON.stringify(
      {
        lane,
        selection,
        catalog: voiceCatalog,
        selected: campaign,
        plannedTurns: campaign.reduce((n, c) => n + c.turns, 0) * repetitions,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (
  selectedCases &&
  lane !== 'suite' &&
  (lane !== 'backend' ||
    !selectedCases.length ||
    selectedCases.some(
      (id) => !backendCases.some((example) => example.id === id),
    ))
)
  throw new Error('Unknown backend cases.');
if (selectedCases && new Set(selectedCases).size !== selectedCases.length)
  throw new Error('Use each case once.');
const plannedPerTrial =
  lane === 'suite'
    ? campaign.reduce((n, c) => n + c.turns, 0)
    : lane === 'http'
      ? 4
      : lane === 'backend'
        ? (selectedCases?.length ?? 5)
        : lane === 'conversation'
          ? naturalVoiceCases.length
          : 3;
const modelSettings =
  COMMAND_PROFILES[profile as keyof typeof COMMAND_PROFILES];
if (!['http', 'voice', 'backend', 'conversation', 'suite'].includes(lane))
  throw new Error('Use http, voice, backend, conversation, or suite.');
if (process.env.RUN_LIVE_CHECK !== 'true')
  throw new Error(
    'Set RUN_LIVE_CHECK=true: this evaluation uses live paid providers.',
  );
const root = fileURLToPath(new URL('../../', import.meta.url));
const runId = randomUUID();
const output = resolve(root, `Evals/evaluations/journey-${lane}-${runId}.json`);
const instanceId = randomUUID();
// A separate process group lets cleanup stop only this evaluation's app and children.
const app = spawn('pnpm', ['run', 'dev', '--host', '127.0.0.1', '--port', '0'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    MATH_AUDIO_COMMAND_PROFILE: profile,
    MATH_AUDIO_DEV_PROBLEM: `eval-latency-${runId}`,
    MATH_AUDIO_DEV_INSTANCE_ID: instanceId,
  },
});
const samples: (JourneySample & Record<string, unknown>)[] = [];
const startedAt = new Date().toISOString();
let failure: string | undefined;
try {
  let origin = '';
  const deadline = performance.now() + 45000;
  while (!origin) {
    if (app.exitCode !== null)
      throw new Error(`Evaluation app exited (${app.exitCode}).`);
    try {
      const manifest = JSON.parse(
        await readFile(
          resolve(root, `Web/.wrangler/dev/${instanceId}/server.json`),
          'utf8',
        ),
      );
      if (manifest.problemLibraryOwner !== `test:dev:eval-latency-${runId}`)
        throw new Error('Unexpected evaluation owner.');
      origin = manifest.url;
    } catch {
      if (performance.now() > deadline)
        throw new Error('Isolated evaluation app did not start.');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  // Use an ordinary isolated guest when local account protection is enabled.
  const guest = await fetch(`${origin}/api/account`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  if (!guest.ok)
    throw new Error(`Evaluation guest setup failed (${guest.status}).`);
  const cookies = guest.headers.getSetCookie().map((cookie) => {
    const pair = cookie.split(';')[0];
    const split = pair.indexOf('=');
    return {
      name: pair.slice(0, split),
      value: pair.slice(split + 1),
      url: origin,
    };
  });
  const cookie = cookies
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
  const read = async (): Promise<CloudSnapshot> => {
    const response = await fetch(`${origin}/api/problems`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(`Problem read failed (${response.status}).`);
    return (await response.json()) as CloudSnapshot;
  };
  let snapshot = await read();
  if (lane === 'suite') {
    const { captureRecordedSuite } =
      await import('../src/browser-recorded-suite.ts');
    for (let trial = 1; trial <= repetitions; trial++)
      await captureRecordedSuite(
        origin,
        read,
        campaign,
        resolve(
          root,
          `Evals/evaluations/journey-suite-${runId}/trial-${trial}`,
        ),
        (sample) => {
          samples.push({ ...sample, trial });
          console.log(
            JSON.stringify({
              trial,
              scenario: sample.scenario,
              category: sample.category,
              passed: sample.passed,
              responseLatencyMs: sample.responseLatencyMs,
              failure: sample.failure,
            }),
          );
        },
        cookies,
      );
  } else if (lane === 'http') {
    for (let trial = 1; trial <= repetitions; trial++) {
      snapshot = await read();
      for (const [text, interpret, expected] of [
        ['write x=0', false, 'x = 0'],
        ['write 2*x+3=11', true, '2 * x + 3 = 11'],
        ['subtract 3 from both sides', true, '2 * x + 3 - 3 = 11 - 3'],
        ['divide both sides by 2', true, '(2 * x + 3 - 3) / 2 = (11 - 3) / 2'],
      ] as const) {
        const start = performance.now();
        try {
          const response = await fetch(`${origin}/api/problems`, {
            method: 'POST',
            headers: {
              Origin: origin,
              Cookie: cookie,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: randomUUID(),
              revision: snapshot.revision,
              operation: { kind: 'command', text, interpret },
            }),
            signal: AbortSignal.timeout(45000),
          });
          const body = (await response.json()) as CloudSnapshot & {
            status?: string;
            aiUnavailable?: boolean;
          };
          const expression = response.ok
            ? currentProblem(body.book).state.expression
            : null;
          const passed =
            response.ok &&
            body.status === 'command' &&
            !body.aiUnavailable &&
            expression === expected;
          samples.push({
            trial,
            text,
            interpret,
            passed,
            status: body.status,
            httpStatus: response.status,
            expectedExpression: expected,
            expression,
            elapsedMs: performance.now() - start,
            timings: serverTimings(response.headers.get('Server-Timing')),
          });
          if (!passed) break;
          snapshot = body;
        } catch {
          samples.push({
            trial,
            text,
            interpret,
            passed: false,
            elapsedMs: performance.now() - start,
            timings: [],
            failure: 'Request or response failed.',
          });
          break;
        }
      }
    }
  } else if (lane === 'backend') {
    for (let trial = 1; trial <= repetitions; trial++)
      for (const example of backendCases.filter(
        (c) => !selectedCases || selectedCases.includes(c.id),
      )) {
        const start = performance.now();
        try {
          const response = await fetch(`${origin}/api/interpret`, {
            method: 'POST',
            headers: {
              Origin: origin,
              Cookie: cookie,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: example.text, state: backendState() }),
            signal: AbortSignal.timeout(45000),
          });
          const body = (await response.json()) as { error?: string };
          const assessed = response.ok
            ? assessBackendAnswer(body, example)
            : { passed: false, status: body.error, expression: null };
          samples.push({
            scenario: example.id,
            trial,
            text: example.text,
            proposal: body,
            ...assessed,
            httpStatus: response.status,
            expectedExpression: example.expression,
            elapsedMs: performance.now() - start,
            timings: serverTimings(response.headers.get('Server-Timing')),
          });
        } catch (error) {
          samples.push({
            scenario: example.id,
            trial,
            text: example.text,
            passed: false,
            elapsedMs: performance.now() - start,
            timings: [],
            failure:
              error instanceof Error
                ? error.message
                : 'Backend evaluation failed.',
          });
        }
        console.log(JSON.stringify({ profile, ...samples.at(-1) }));
      }
  } else {
    const { captureVoiceJourneys } = await import('../src/browser-journey.ts');
    const { captureVoiceConversation } =
      await import('../src/browser-conversation.ts');
    const capture: typeof captureVoiceJourneys =
      lane === 'conversation'
        ? (origin, read, record, voice, cookies) =>
            captureVoiceConversation(
              origin,
              read,
              record,
              voice,
              undefined,
              cookies,
            )
        : captureVoiceJourneys;
    const scenarios =
      lane === 'conversation'
        ? naturalVoiceCases.map((c) => c.id)
        : ['cold-equation', 'warm-step', 'reconnected-equation'];
    for (let trial = 1; trial <= repetitions; trial++) {
      const trialStart = performance.now();
      const recorded = new Set<string>();
      const voice =
        lane === 'conversation'
          ? 'Daniel'
          : ['Daniel', 'Karen', 'Rishi'][(trial - 1) % 3];
      try {
        snapshot = await read();
        const reset = await fetch(`${origin}/api/problems`, {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: cookie,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: randomUUID(),
            revision: snapshot.revision,
            operation: { kind: 'new', title: `Latency trial ${trial}` },
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!reset.ok) throw new Error('Could not isolate trial problem.');
        await capture(
          origin,
          read,
          (sample) => {
            recorded.add(String(sample.scenario));
            samples.push({ ...sample, trial, voice });
            console.log(
              JSON.stringify({
                trial,
                voice,
                scenario: sample.scenario,
                passed: sample.passed,
                elapsedMs: sample.elapsedMs,
              }),
            );
          },
          voice,
          cookies,
        );
      } catch (error) {
        for (const scenario of scenarios.filter((name) => !recorded.has(name)))
          samples.push({
            trial,
            voice,
            scenario,
            passed: false,
            responseLatencyMs: null,
            elapsedMs: performance.now() - trialStart,
            timings: [],
            failure: `Trial setup or capture failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        if (recorded.size === scenarios.length)
          failure = 'A trial completed but its cleanup was not confirmed.';
      }
    }
  }
} catch (error) {
  failure = error instanceof Error ? error.message : 'Evaluation failed.';
} finally {
  if (app.pid) {
    try {
      process.kill(-app.pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
  }
  const sourceHash = createHash('sha256');
  const sourceFiles = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'Web/src',
      'Web/app',
      'Web/scripts',
      'Evals/src',
      'Evals/scripts',
      'Web/package.json',
      'Evals/package.json',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ],
    { cwd: root, encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const file of [...new Set(sourceFiles)].sort())
    sourceHash.update(file + '\0').update(await readFile(resolve(root, file)));
  const report = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    lane,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    dirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    ),
    sourceSHA256: sourceHash.digest('hex'),
    runnerSHA256: createHash('sha256')
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest('hex'),
    models: { live: LIVE_MODEL, command: modelSettings.model },
    commandProfile: profile,
    reasoning: modelSettings.reasoning ?? null,
    latencyDefinition:
      lane === 'suite'
        ? 'Harness duration includes setup, fixture, saved outcome, finished reply and evidence capture; responseLatencyMs separately measures last input to display.'
        : lane === 'conversation'
          ? 'Fixture start through verified saved outcome and finished spoken reply; includes playback and polling.'
          : lane !== 'voice'
            ? 'HTTP request start through complete parsed response body.'
            : 'Last detected input signal through React display commit; harnessElapsedMs includes fixture playback, polling and deliberate idle waits.',
    scope:
      lane !== 'voice' && lane !== 'conversation' && lane !== 'suite'
        ? 'Live provider and isolated local HTTP; excludes voice and rendering.'
        : 'Synthetic recorded speech through browser, GPT Live, backend, persistence and React commit; excludes physical microphone and student usability.',
    failure,
    repetitions,
    selection:
      lane === 'suite'
        ? {
            ...selection,
            selected: campaign,
            catalogSHA256: createHash('sha256')
              .update(
                JSON.stringify({
                  voiceCatalog,
                  recordedScenarios,
                  naturalVoiceCases,
                }),
              )
              .digest('hex'),
          }
        : undefined,
    campaignSummary:
      lane === 'suite'
        ? {
            ...summarizeCampaign(samples, plannedPerTrial * repetitions),
            latencyDefinition:
              'Last input signal to saved display commit; milliseconds. Correctness has no speed budget. Harness durations include setup, playback and evidence capture.',
            byCategory: Object.fromEntries(
              [...new Set(campaign.map((c) => c.category))].map((category) => [
                category,
                summarizeCampaign(
                  samples.filter((s) => s.category === category),
                  campaign
                    .filter((c) => c.category === category)
                    .reduce((n, c) => n + c.turns, 0) * repetitions,
                ),
              ]),
            ),
            unattemptedCases: Array.from(
              { length: repetitions },
              (_, index) => index + 1,
            ).flatMap((trial) =>
              campaign.flatMap((c) =>
                (c.id === 'natural-conversation'
                  ? naturalVoiceCases.map((turn) => turn.id)
                  : [c.id]
                )
                  .filter(
                    (scenario) =>
                      !samples.some(
                        (s) => s.trial === trial && s.scenario === scenario,
                      ),
                  )
                  .map((scenario) => ({ trial, family: c.id, scenario })),
              ),
            ),
          }
        : undefined,
    planned: plannedPerTrial * repetitions,
    unattempted: plannedPerTrial * repetitions - samples.length,
    groups:
      lane === 'http'
        ? {
            direct: summarizeJourneys(
              samples.filter((s) => s.interpret === false),
            ),
            interpreted: summarizeJourneys(
              samples.filter((s) => s.interpret === true),
            ),
          }
        : Object.fromEntries(
            (lane === 'suite'
              ? campaign.map((c) => c.id)
              : lane === 'backend'
                ? backendCases.map((example) => example.id)
                : lane === 'conversation'
                  ? naturalVoiceCases.map((c) => c.id)
                  : ['cold-equation', 'warm-step', 'reconnected-equation']
            ).map((scenario) => [
              scenario,
              lane === 'suite'
                ? summarizeCampaign(
                    samples.filter((s) => s.family === scenario),
                    campaign.find((c) => c.id === scenario)!.turns *
                      repetitions,
                  )
                : summarizeJourneys(
                    samples.filter((s) => s.scenario === scenario),
                  ),
            ]),
          ),
    summary:
      lane === 'suite'
        ? summarizeCampaign(samples, plannedPerTrial * repetitions)
        : { ...summarizeJourneys(samples), successInterval80: null },
    intervalMethod:
      lane === 'suite'
        ? 'No pooled interval: cases are stratified families and conversation turns share state.'
        : 'Two-sided 80% Wilson score; per scenario only. Pooled confidence omitted because scenarios share trials.',
    samples,
  };
  await mkdir(resolve(root, 'Evals/evaluations'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({ report: output, failure, summary: report.summary }),
  );
  if (
    failure ||
    samples.length < plannedPerTrial * repetitions ||
    samples.some((s) => !s.passed)
  )
    process.exitCode = 1;
}

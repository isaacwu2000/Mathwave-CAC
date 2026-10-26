import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  COMMAND_MODEL,
  interpretationInstructions,
  interpretationSchema,
} from '../../Web/src/modules/ai/index.ts';
import {
  runMathProgram,
  mathProgramCommand,
  toolCatalog,
} from '../../Web/src/modules/commands/index.ts';
import {
  applyCloudOperation,
  createProblemLibrary,
  currentProblem,
  recordStep,
} from '../../Web/src/modules/problems/index.ts';
import {
  graphFunction,
  numberedGraphs,
} from '../../Web/src/modules/visuals/index.ts';
import type { Workspace } from '../../Web/src/modules/workspace/state.ts';
import { interpretWithPrompt } from '../src/prompt-provider.ts';
import { captureScreenEvidence } from '../src/screen-evidence.ts';

// Caller-owned synthetic books; real model requests followed by saved-state replay in the actual app.
if (process.env.RUN_LIVE_CHECK !== 'true')
  throw new Error('Set RUN_LIVE_CHECK=true for the bounded paired text check.');
process.loadEnvFile(new URL('../../Web/.env', import.meta.url).pathname);
if (!process.env.OPENAI_API_KEY)
  throw new Error('Provider credentials unavailable.');
const origin = process.argv[2] || 'http://localhost:5191';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Use an isolated local app.');
const directory = new URL(
  '../evaluations/shared-prompt-compact-2026-10-23/',
  import.meta.url,
);
const baseline = JSON.parse(
  await readFile(new URL('baseline.json', directory), 'utf8'),
);
const stripDescriptions = (catalog: typeof toolCatalog) =>
  Object.fromEntries(
    Object.entries(catalog).map(([name, definition]) => {
      const { description: _description, ...contract } = definition;
      return [name, contract];
    }),
  );
if (
  JSON.stringify(stripDescriptions(baseline.toolCatalog)) !==
    JSON.stringify(stripDescriptions(toolCatalog)) ||
  JSON.stringify(baseline.interpretationSchema) !==
    JSON.stringify(interpretationSchema)
)
  throw new Error('Tool contract or response schema changed.');
await writeFile(
  new URL('compact-prompt.txt', directory),
  interpretationInstructions,
);
const provider = {
  model: COMMAND_MODEL,
  url: 'https://api.openai.com/v1/responses',
  key: process.env.OPENAI_API_KEY,
};
const equation = (source: string) =>
  `problem.save(math.equation(${JSON.stringify(source)}));`;
const graphValues = (s: Workspace) =>
  numberedGraphs(s).map((row) => graphFunction(row.expression).value(2));
const cases = [
  {
    id: 'ordered-algebra',
    seed: [equation('2*x+3=11')],
    turns: [
      {
        text: 'Subtract three from both sides, then simplify.',
        expression: '2 * x = 8',
        delta: 2,
      },
    ],
  },
  {
    id: 'occurrence-edit',
    seed: [equation('3*x+4=19')],
    turns: [
      {
        text: 'Replace just the constant four with seven.',
        expression: '3 * x + 7 = 19',
        delta: 1,
      },
    ],
  },
  {
    id: 'graph-follow-up',
    seed: ['problem.save(graph.plot("x^2"));'],
    turns: [
      {
        text: 'Add a second curve y equals x plus one, keeping the parabola.',
        values: [4, 3],
      },
      { text: 'Move only the first curve up by two.', values: [6, 3] },
    ],
  },
  {
    id: 'geometry-scale',
    seed: ['problem.save(geometry.create("right triangle",{a:3,b:4}));'],
    turns: [
      {
        text: 'Double both legs of this right triangle.',
        dimensions: { a: 6, b: 8 },
      },
    ],
  },
  {
    id: 'statistics-edit',
    seed: ['problem.save(statistics.data([2,4,9]));'],
    turns: [
      { text: 'Change just the four to eight in this data.', data: [2, 8, 9] },
    ],
  },
  {
    id: 'undo',
    seed: [
      equation('x+3=8'),
      'problem.save(math.subtractBothSides(problem.currentEquation(),3));',
    ],
    turns: [
      { text: 'Undo the last step.', expression: 'x + 3 = 8', delta: -1 },
    ],
  },
];
const variants = {
  baseline: baseline.interpretationInstructions as string,
  compact: interpretationInstructions,
};
const results: Record<string, unknown>[] = [];
let calls = 0;
const report = {
  model: COMMAND_MODEL,
  maximumCalls: 32,
  calls: 0,
  baseCharacters: baseline.interpretationInstructions.length,
  compactCharacters: interpretationInstructions.length,
  contractsUnchanged: true,
  schemaUnchanged: true,
  lane: 'Real text provider and shared engine; isolated actual-app saved-state replay. No microphone, streaming transport, iPhone or latency claim.',
  visualReview: 'pending human/agent inspection of every screenshot',
  results,
};
const sourcePaths = [
  'Web/src/modules/ai/config/interpretation.ts',
  'Web/src/modules/ai/services/command-instructions.ts',
  'Web/src/modules/commands/config/program-instructions.ts',
  'Web/src/modules/commands/config/tool-catalog.ts',
  'Native/Engine/agent.ts',
  'Evals/src/prompt-provider.ts',
  'Evals/scripts/check-compact-prompts.ts',
];
const sources = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (name) => [
      name,
      createHash('sha256')
        .update(await readFile(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  ),
);
const save = () =>
  writeFile(
    new URL('report.json', directory),
    JSON.stringify({ ...report, calls, sourceSha256: sources }, null, 2) + '\n',
  );
await save();
const browser = await chromium.launch({ headless: true });
try {
  for (const [caseIndex, example] of cases.entries()) {
    // Alternate prompt order; each variant starts from its own equivalent book.
    const order =
      caseIndex % 2
        ? (['compact', 'baseline'] as const)
        : (['baseline', 'compact'] as const);
    for (const variant of order) {
      let book = createProblemLibrary();
      for (const program of example.seed)
        book = recordStep(
          book,
          runMathProgram(currentProblem(book).state, program).state,
          mathProgramCommand(program),
        );
      for (const [turnIndex, turn] of example.turns.entries()) {
        const before = currentProblem(book);
        const answer = await interpretWithPrompt(
          turn.text,
          { book, clarification: null },
          variants[variant],
          provider,
          () => {
            if (++calls > 32) throw new Error('Provider call ceiling reached.');
          },
        );
        const row: Record<string, unknown> = {
          id: example.id,
          variant,
          turn: turnIndex + 1,
          text: turn.text,
          answer,
          passed: false,
          screens: [],
        };
        results.push(row);
        await save();
        if (!answer.interpretation)
          throw new Error(
            `No interpretation for ${example.id}/${variant}: ${answer.error}`,
          );
        const plan = answer.interpretation;
        const outcome = await applyCloudOperation(
          { book, clarification: null },
          { kind: 'command', text: turn.text, interpret: true },
          async () => plan,
        );
        book = outcome.book;
        const after = currentProblem(book),
          state = after.state;
        const expected = turn as {
          expression?: string;
          delta?: number;
          values?: number[];
          dimensions?: object;
          data?: number[];
        };
        const errors = [];
        if (expected.expression && state.expression !== expected.expression)
          errors.push(
            `Expected ${expected.expression}; got ${state.expression}`,
          );
        if (
          expected.delta !== undefined &&
          after.steps.length - before.steps.length !== expected.delta
        )
          errors.push('Wrong requested step boundary/history delta');
        if (
          expected.values &&
          JSON.stringify(graphValues(state)) !== JSON.stringify(expected.values)
        )
          errors.push('Wrong curves at x=2');
        if (
          expected.dimensions &&
          JSON.stringify(state.geometry?.dimensions) !==
            JSON.stringify(expected.dimensions)
        )
          errors.push('Wrong triangle dimensions');
        if (
          expected.data &&
          JSON.stringify(state.data) !== JSON.stringify(expected.data)
        )
          errors.push('Wrong data');
        Object.assign(row, {
          passed: errors.length === 0,
          errors,
          state,
          message: outcome.message,
        });
        const screenshots = [];
        for (const viewport of [
          { width: 1280, height: 900 },
          { width: 390, height: 844 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.route('**/api/live-token', (route) =>
            route.fulfill({ json: { configured: false } }),
          );
          await page.route('**/api/problems', (route) =>
            route.fulfill({
              json: { book, clarification: null, revision: turnIndex + 1 },
            }),
          );
          await page.goto(origin);
          await page
            .locator('.app-shell[data-ready="true"]')
            .waitFor({ timeout: 30000 });
          await page.evaluate(() => document.fonts.ready);
          if (state.graph)
            await page.locator('.graph-card canvas').first().waitFor();
          await page.waitForTimeout(300);
          const name = `${example.id}-${variant}-${turnIndex + 1}-${viewport.width}`;
          screenshots.push({
            ...(await captureScreenEvidence(
              page,
              directory.pathname,
              name,
              state,
              after.steps.length,
            )),
            viewport,
          });
          await page.close();
        }
        row.screens = screenshots;
        await save();
        console.log(
          JSON.stringify({
            id: example.id,
            variant,
            turn: turnIndex + 1,
            passed: row.passed,
            errors,
            calls,
          }),
        );
      }
    }
  }
} finally {
  await browser.close();
  await save();
}
if (results.some((row) => !row.passed)) process.exitCode = 1;

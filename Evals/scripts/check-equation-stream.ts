import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  createProblemLibrary,
  currentProblem,
  recordStep,
  applyMathPlan,
} from '../../Web/src/modules/problems/index.ts';
import {
  runCommand,
  validateModelInterpretation,
} from '../../Web/src/modules/commands/index.ts';
import {
  interpretationSchema,
  commandInstructionsFor,
  COMMAND_MODEL,
} from '../../Web/src/modules/ai/index.ts';
import { interpretationStream } from '../../Web/src/modules/ai/index.ts';
type StreamWindow = Window & {
  streams: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  frame(id: string, frame: object | null): void;
  beginStream(id: string): Promise<void>;
  streamVoice: {
    events: { execute(text: string, id: string): Promise<unknown> };
  };
};
const origin = process.argv[2] ?? 'http://localhost:5184';
const live = process.env.RUN_LIVE_CHECK === 'true';
const output = new URL(
  `../../output/playwright/equation-stream-${live ? 'live' : 'mock'}/`,
  import.meta.url,
).pathname;
await mkdir(output, { recursive: true });
if (live)
  process.loadEnvFile(new URL('../../Web/.env', import.meta.url).pathname);
const source =
  'A=point(0,0)\nB=point(3,0)\nC=point(0,4)\ndraw triangle(A,B,C)\nrightangle B,A,C\nmeasure segment(A,B)\nmeasure segment(A,C)\nlabel segment(B,C), h';
let book = createProblemLibrary();
for (const command of [
  'typescript\nproblem.save(geometry.construct(' +
    JSON.stringify(source) +
    '));',
  'write h^2=3^2+4^2',
]) {
  book = recordStep(
    book,
    runCommand(currentProblem(book).state, command).state,
    command,
  );
}
const initial = structuredClone(book);
const request =
  'Show these steps in order: write h squared equals 9 plus 16, then write h squared equals 25, then write h equals 5. Keep the triangle.';
const programs = [
  'problem.save(math.equation("h^2=9+16"));',
  'problem.save(math.equation("h^2=25"));',
  'problem.save(math.equation("h=5"));',
];
const previews: object[] = [];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.route('**/api/account', (route) =>
    route.fulfill({
      json: {
        identity: {
          kind: 'development',
          owner: 'equation-stream-test',
          verified: true,
        },
        allowanceMs: 600000,
        remainingMs: 600000,
        resetsAt: null,
        authConfigured: true,
      },
    }),
  );
  await context.route('**/api/live-token', (route) =>
    route.fulfill({ json: { configured: true } }),
  );
  await context.route('**/openai-voice-session.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `export class OpenAIVoiceSession { constructor(events) { this.events=events; window.streamVoice=this; } stop() { this.events.reply(''); this.events.partial(''); this.events.state('idle'); this.events.playback(false); } setReplies() {} resume() {} stopListening() {} setPace() {} reportFacts() {} toggle() {} }`,
    }),
  );
  const page = await context.newPage();
  await page.route('**/api/problems', (route) =>
    route.fulfill({ json: { book, revision: 0, clarification: null } }),
  );
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const scope = window as unknown as StreamWindow;
    scope.streams = new Map();
    scope.frame = (id: string, frame: object | null) => {
      const c = scope.streams.get(id);
      if (!c) throw new Error('Unknown synthetic request stream.');
      if (frame)
        c.enqueue(new TextEncoder().encode(JSON.stringify(frame) + '\n'));
      else {
        try {
          c.close();
        } catch {}
        scope.streams.delete(id);
      }
    };
    window.fetch = async (url, init) => {
      if (
        url === '/api/problems' &&
        init?.method === 'POST' &&
        typeof init.body === 'string'
      ) {
        const data = JSON.parse(init.body);
        if (data.operation.kind === 'command') {
          const id = crypto.randomUUID();
          return new Response(
            new ReadableStream({
              start(c) {
                scope.streams.set(id, c);
                void scope.beginStream(id);
              },
            }),
            { headers: { 'Content-Type': 'application/x-ndjson' } },
          );
        }
      }
      return original(url, init);
    };
  });
  let rejectBatch = false;
  await page.exposeFunction('beginStream', async (id: string) => {
    const push = async (frame: object | null) =>
      page.evaluate(
        ({ id, frame }) => (window as unknown as StreamWindow).frame(id, frame),
        {
          id,
          frame,
        },
      );
    let count = 0;
    const preview = async (sources: string[]) => {
      const validated = validateModelInterpretation(
        {
          status: 'command',
          programs: sources,
          message: '',
          presentation: null,
        },
        currentProblem(initial).state,
        undefined,
        request,
      );
      const temporary = applyMathPlan(
        initial,
        validated.commands ?? [validated.command],
      );
      const problem = currentProblem(temporary.book);
      previews.push({
        index: count,
        expressions: problem.steps.map((s) => s.state.expression),
      });
      await push({
        type: 'progress',
        progress: {
          phase: 'checking',
          workspace: problem.state,
          steps: problem.steps,
        },
      });
      await page.waitForTimeout(250);
      assert.equal(
        await page.locator('.step-equation').count(),
        problem.steps.filter((s) => s.state.mode === 'equation').length,
      );
      await page.screenshot({
        path:
          output + `${rejectBatch ? 'rollback-' : ''}preview-${count++}.png`,
      });
      return temporary;
    };
    let final = applyMathPlan(
      initial,
      programs.map((p) => 'typescript\n' + p),
    );
    if (live && !rejectBatch) {
      const instructions = commandInstructionsFor(
        request,
        currentProblem(initial).state,
      );
      await writeFile(
        output + 'prompt.json',
        JSON.stringify(
          {
            model: COMMAND_MODEL,
            instructions,
            interpretationSchema,
            request,
            workspace: currentProblem(initial).state,
            sourceHash: createHash('sha256')
              .update(
                await readFile(
                  new URL(
                    '../../Web/src/modules/ai/services/interpretation-stream.ts',
                    import.meta.url,
                  ),
                ),
              )
              .digest('hex'),
          },
          null,
          2,
        ),
      );
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: COMMAND_MODEL,
          instructions,
          input: JSON.stringify({
            request,
            workspace: currentProblem(initial).state,
          }),
          stream: true,
          store: false,
          max_output_tokens: 2400,
          text: {
            format: {
              type: 'json_schema',
              name: 'math_command',
              strict: true,
              schema: interpretationSchema,
            },
          },
        }),
      });
      let queue = Promise.resolve();
      const result = await interpretationStream(
        response,
        AbortSignal.timeout(40000),
        (sources) => {
          queue = queue.then(async () => {
            await preview(sources);
          });
        },
      );
      await queue;
      const answer = result.output
        ?.flatMap((o) => o.content ?? [])
        .find((c) => c.type === 'output_text')?.text;
      const validated = validateModelInterpretation(
        JSON.parse(answer!),
        currentProblem(initial).state,
        undefined,
        request,
      );
      final = applyMathPlan(initial, validated.commands ?? [validated.command]);
      await writeFile(
        output + 'provider.json',
        JSON.stringify(result, null, 2),
      );
    } else {
      for (let n = 1; n <= programs.length; n++)
        await preview(programs.slice(0, n));
    }
    if (rejectBatch) {
      await push({
        type: 'progress',
        progress: {
          phase: 'fixing',
          workspace: currentProblem(initial).state,
          steps: currentProblem(initial).steps,
        },
      });
      await page.waitForTimeout(250);
      await page.screenshot({ path: output + 'rollback-restored.png' });
      book = structuredClone(initial);
    } else book = final.book;
    await push({
      type: 'result',
      status: 200,
      body: {
        book,
        revision: rejectBatch ? 0 : 1,
        clarification: null,
        status: rejectBatch ? 'unsupported' : 'command',
        message: rejectBatch
          ? 'Could not complete that batch.'
          : 'Steps saved.',
      },
    });
    await push(null);
  });
  await page.goto(origin);
  await page.locator('.app-shell[data-ready="true"]').waitFor();
  await page.waitForFunction(
    () => !!(window as unknown as StreamWindow).streamVoice,
  );
  await page.evaluate((text) => {
    void (window as unknown as StreamWindow).streamVoice.events.execute(
      text,
      crypto.randomUUID(),
    );
  }, request);
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.step-equation').length === 4 &&
      !document.querySelector('[data-command-phase]'),
  );
  assert.equal(currentProblem(book).state.expression, 'h = 5');
  await page.screenshot({ path: output + 'desktop-final.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show graph', exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: output + 'mobile-graph.png' });
  await page.getByRole('button', { name: 'Close graph', exact: true }).click();
  await page.screenshot({ path: output + 'mobile-final.png' });
  if (!live) {
    rejectBatch = true;
    book = structuredClone(initial);
    await page.reload();
    await page.locator('.app-shell[data-ready="true"]').waitFor();
    await page.evaluate((text) => {
      void (window as unknown as StreamWindow).streamVoice.events.execute(
        text,
        crypto.randomUUID(),
      );
    }, request);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.step-equation').length === 1 &&
        !document.querySelector('[data-command-phase]'),
    );
    assert.equal(currentProblem(book).state.expression, 'h^2 = 3^2 + 4^2');
  }
  await writeFile(
    output + 'report.json',
    JSON.stringify(
      {
        live,
        request,
        previews,
        finalExpression: currentProblem(book).state.expression,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: equation history streamed in the real app; geometry retained; final/rollback verified.',
    output,
  );
} finally {
  await browser.close();
}

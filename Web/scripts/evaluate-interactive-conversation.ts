import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createProblemLibrary,
  currentProblem,
  applyMathPlan,
  rememberConversation,
  presentExplanation,
  adjustExplanation,
  correctConversation,
  decodeProblemLibrary,
  historyContext,
} from '../src/modules/problems/index.ts';
import {
  validateInterpretation,
  type Interpretation,
} from '../src/modules/commands/index.ts';
import { explorationView } from '../src/modules/visuals/index.ts';
let book = applyMathPlan(createProblemLibrary(), ['write 7*x+5=26']).book;
const original = structuredClone(currentProblem(book));
const results: unknown[] = [];
let passed = 0;
const origin = process.env.EVAL_ORIGIN || 'http://localhost:3000';
async function turn(
  request: string,
  check: (result: Interpretation) => boolean,
) {
  const before = book,
    p = currentProblem(book),
    start = performance.now();
  const response = await fetch(`${origin}/api/interpret`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: request,
      state: p.state,
      history: historyContext(book),
      conversation: p.conversation,
      exploration: p.exploration,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status}: ${((await response.json()) as { error?: string }).error}`,
    );
  const result = validateInterpretation(
    await response.json(),
    p.state,
    historyContext(book),
    request,
  );
  if (result.status === 'correction')
    book = correctConversation(book, result.commands || [], request).book;
  else {
    const applied =
      result.status === 'command'
        ? applyMathPlan(
            book,
            result.commands?.length ? result.commands : [result.command],
          )
        : { book, message: result.message };
    book = rememberConversation(
      before,
      applied.book,
      request,
      result.message || applied.message,
      result.status,
      result.commands,
    );
    book = presentExplanation(book, result.presentation);
  }
  const after = currentProblem(book);
  const unchanged =
    JSON.stringify(after.state) === JSON.stringify(original.state) &&
    JSON.stringify(after.steps) === JSON.stringify(original.steps);
  const pass = unchanged && check(result);
  if (pass) passed++;
  results.push({
    request,
    result,
    pass,
    unchanged,
    exploration: after.exploration,
    latencyMs: Math.round(performance.now() - start),
  });
  console.log(
    JSON.stringify({
      turn: results.length,
      pass,
      status: result.status,
      title: after.exploration?.title,
    }),
  );
  book = decodeProblemLibrary(JSON.stringify(book));
  await new Promise((r) => setTimeout(r, 8000));
}
try {
  await turn(
    'I know people say keep the equation balanced, but I don’t really get what is being kept. Explain without doing my homework.',
    (r) => ['reply', 'explanation'].includes(r.status) && !r.commands?.length,
  );
  await turn(
    'Could I try taking different amounts off each side together, with something adjustable here? Keep my actual equation as it is.',
    () => !!currentProblem(book).exploration?.controls.length,
  );
  const balance = currentProblem(book).exploration;
  if (!balance?.controls.length)
    throw new Error('Missing balance control for adaptive follow-up.');
  const c = balance.controls[0];
  const value = Math.min(c.max, c.min + 2 * c.step);
  book = adjustExplanation(book, c.name, value);
  await turn(
    `I moved ${c.label} to ${value}. What changed, and what stayed the same? Don’t adjust it again.`,
    (r) =>
      ['reply', 'explanation'].includes(r.status) &&
      !r.commands?.length &&
      currentProblem(book).exploration?.controls[0].value === value,
  );
  await turn(
    'Different example: let me widen a rectangle while its height stays at three. I want to compare its area with the distance around it as I move one control.',
    () =>
      !!currentProblem(book).exploration?.controls.length &&
      currentProblem(book).exploration!.readouts.length >= 2,
  );
  const rectangle = currentProblem(book).exploration;
  const width =
    rectangle?.controls.find((c) => /width/i.test(c.label)) ||
    rectangle?.controls[0];
  if (!width) throw new Error('Missing rectangle width control.');
  await turn(
    `Put ${width.label} at four, please. I’m only changing the little demonstration.`,
    () => {
      const lesson = currentProblem(book).exploration;
      if (!lesson) return false;
      const values = explorationView(lesson).readouts;
      return (
        lesson.controls.some((c) => c.value === 4) &&
        values.some((v) => /area/i.test(v.label) && v.value === '12') &&
        values.some(
          (v) => /perimeter|around/i.test(v.label) && v.value === '14',
        )
      );
    },
  );
  await turn(
    'Say the takeaway in one short sentence; don’t replace the demonstration.',
    (r) =>
      ['reply', 'explanation'].includes(r.status) &&
      r.message.length < 350 &&
      r.presentation === undefined,
  );
  await turn(
    'That was helpful. Put the demonstration away, but leave all of my work here.',
    () => !currentProblem(book).exploration,
  );
  await turn(
    'Thanks, I’m going to think about it myself now.',
    (r) =>
      ['reply', 'explanation'].includes(r.status) &&
      !r.commands?.length &&
      !currentProblem(book).exploration,
  );
} catch (error) {
  results.push({
    error: error instanceof Error ? error.message : String(error),
    pass: false,
  });
}
const report = {
  createdAt: new Date().toISOString(),
  scope:
    'Fresh live-AI text conversations with adaptive control references, deterministic numeric checks, persistence between turns, and unchanged homework. Not microphone or student usability evidence.',
  total: 8,
  passed,
  results,
};
mkdirSync('../Evals/evaluations', { recursive: true });
const path = `../Evals/evaluations/interactive-conversation-${Date.now()}.json`;
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(path);
if (passed !== 8) process.exitCode = 1;
